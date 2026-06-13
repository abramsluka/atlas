import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import type { OuraData, WhoopData } from '@/features/health/types'

type Verdict = 'GREEN' | 'YELLOW' | 'RED'

interface TodaysCall {
  color: Verdict
  headline: string
  bullets: string[]
}

function verdictFromOura(score: number): Verdict {
  if (score >= 80) return 'GREEN'
  if (score >= 60) return 'YELLOW'
  return 'RED'
}

function verdictFromWhoop(recoveryScore: number): Verdict {
  if (recoveryScore >= 67) return 'GREEN'
  if (recoveryScore >= 34) return 'YELLOW'
  return 'RED'
}

async function generateCall(
  verdict: Verdict,
  oura: OuraData | null,
  whoop: WhoopData | null,
): Promise<{ headline: string; bullets: string[] }> {
  const lines: string[] = [`Readiness verdict: ${verdict}`]

  if (oura?.readiness?.score != null) lines.push(`Oura readiness score: ${oura.readiness.score}`)
  if (oura?.readiness?.temperature_deviation != null) lines.push(`Oura temperature deviation: ${oura.readiness.temperature_deviation.toFixed(2)}°C`)
  if (oura?.sleep?.score != null) lines.push(`Oura sleep score: ${oura.sleep.score}`)
  if (oura?.sleep?.average_hrv != null) lines.push(`Oura HRV: ${Math.round(oura.sleep.average_hrv)}ms`)
  if (oura?.sleep?.resting_heart_rate != null) lines.push(`Oura RHR: ${Math.round(oura.sleep.resting_heart_rate)}bpm`)
  if (oura?.activity?.steps != null) lines.push(`Oura steps yesterday: ${oura.activity.steps.toLocaleString()}`)
  if (oura?.activity?.active_calories != null) lines.push(`Oura active calories yesterday: ${oura.activity.active_calories}`)
  if (whoop?.recovery?.score != null) lines.push(`Whoop recovery: ${whoop.recovery.score}%`)
  if (whoop?.recovery?.hrv_rmssd_milli != null) lines.push(`Whoop HRV: ${Math.round(whoop.recovery.hrv_rmssd_milli)}ms`)
  if (whoop?.cycle?.strain != null) lines.push(`Whoop strain yesterday: ${whoop.cycle.strain.toFixed(1)}`)

  const prompt = `${lines.join('\n')}

Write a Today's Call card:
1. One punchy sentence (under 20 words) that tells the user what to do today. Match the energy: GREEN = aggressive push, YELLOW = moderate effort, RED = rest/recover.
2. Then 3–4 bullet points in ✓ format, each being one specific metric from the data above with a plain-English reading. Keep each bullet under 10 words.

Return as JSON: { "headline": "...", "bullets": ["✓ ...", "✓ ...", "✓ ..."] }
No hedging, no "consider", no "might". Direct statements only.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = msg.content[0].type === 'text' ? msg.content[0].text : ''
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in Claude response')
  const parsed = JSON.parse(jsonMatch[0])
  return {
    headline: String(parsed.headline ?? '').trim(),
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : [],
  }
}

export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const url = new URL(req.url)
  const forceRefresh = url.searchParams.get('refresh') === '1'

  // Return cached result if it exists for today (unless forced refresh)
  if (!forceRefresh) {
    const { data: cached } = await db
      .from('todays_call')
      .select('color, headline, bullets')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()

    if (cached) return NextResponse.json(cached)
  }

  // Fetch wearable data
  const [ouraRes, whoopRes] = await Promise.all([
    db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'oura').eq('date', today).maybeSingle(),
    db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'whoop').eq('date', today).maybeSingle(),
  ])

  const oura = ouraRes.data?.data as OuraData | null
  const whoop = whoopRes.data?.data as WhoopData | null

  // Determine verdict — need at least one usable signal
  let verdict: Verdict | null = null
  if (oura?.readiness?.score != null) {
    verdict = verdictFromOura(oura.readiness.score)
  } else if (whoop?.recovery?.score != null) {
    verdict = verdictFromWhoop(whoop.recovery.score)
  }

  if (!verdict) return NextResponse.json({ noData: true })

  const { headline, bullets } = await generateCall(verdict, oura, whoop)

  await db.from('todays_call').upsert(
    { user_id: user.id, date: today, color: verdict, headline, bullets },
    { onConflict: 'user_id,date' },
  )

  return NextResponse.json({ color: verdict, headline, bullets })
}
