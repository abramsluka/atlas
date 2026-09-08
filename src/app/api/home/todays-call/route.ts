import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateText, type LanguageModel } from 'ai'
import { getModelForFeature, suggestedProviderFor } from '@/lib/aiProvider'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { syncOuraToday } from '@/features/health/ouraSync'
import { syncWhoopToday } from '@/features/health/whoopSync'
import { syncFitbitToday } from '@/features/health/fitbitSync'
import { getActiveWearableProvider, WEARABLE_LABEL, type WearableProvider } from '@/features/health/wearableProvider'
import type { OuraData } from '@/features/health/types'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'

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

function verdictFor(oura: OuraData | null): Verdict | null {
  if (oura?.readiness?.score != null) return verdictFromOura(oura.readiness.score)
  return null
}

async function generateCall(
  model: LanguageModel,
  verdict: Verdict,
  oura: OuraData | null,
  profileBlock: string,
  provider: WearableProvider = 'oura',
): Promise<{ headline: string; bullets: string[] }> {
  const lines: string[] = [`Readiness verdict: ${verdict}`]

  // Name the actual device — the model quotes these labels back to the user.
  // For Fitbit the label also says the readiness is an Atlas estimate.
  const w = WEARABLE_LABEL[provider].name

  if (oura?.readiness?.score != null) lines.push(`${WEARABLE_LABEL[provider].recovery}: ${oura.readiness.score}`)
  if (oura?.readiness?.temperature_deviation != null) lines.push(`${w} temperature deviation: ${oura.readiness.temperature_deviation.toFixed(2)}°C`)
  if (oura?.sleep?.score != null) lines.push(`${w} sleep score: ${oura.sleep.score}`)
  if (oura?.sleep?.average_hrv != null) lines.push(`${w} HRV: ${Math.round(oura.sleep.average_hrv)}ms`)
  if (oura?.sleep?.resting_heart_rate != null) lines.push(`${w} RHR: ${Math.round(oura.sleep.resting_heart_rate)}bpm`)
  if (oura?.activity?.steps != null) lines.push(`${w} steps yesterday: ${oura.activity.steps.toLocaleString()}`)
  if (oura?.activity?.active_calories != null) lines.push(`${w} active calories yesterday: ${oura.activity.active_calories}`)

  const prompt = `${lines.join('\n')}

Write a Today's Call card:
1. One punchy sentence (under 20 words) that tells the user what to do today. Match the energy: GREEN = aggressive push, YELLOW = moderate effort, RED = rest/recover.
2. Then 3–4 bullet points in ✓ format, each being one specific metric from the data above with a plain-English reading. Keep each bullet under 10 words.

Return as JSON: { "headline": "...", "bullets": ["✓ ...", "✓ ...", "✓ ..."] }
No hedging, no "consider", no "might". Direct statements only.`

  const { text: raw } = await generateText({
    model,
    maxOutputTokens: 200,
    ...(profileBlock ? { system: profileBlock } : {}),
    messages: [{ role: 'user', content: prompt }],
  })

  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in model response')
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

  // The home page never triggers a wearable sync on its own, so without this
  // the card is blank every morning until the Health page is opened. Pull
  // today's data for the active wearable first (both syncs have their own
  // 15-min cache, so this is cheap when already fresh).
  const provider = (await getActiveWearableProvider(db, user.id)) ?? 'oura'
  if (provider === 'fitbit') await syncFitbitToday(db, user.id, today, tz).catch(() => null)
  else await (provider === 'whoop' ? syncWhoopToday : syncOuraToday)(db, user.id, today).catch(() => null)

  // Fetch the active wearable's data for today
  const ouraRes = await db
    .from('wearable_data').select('data')
    .eq('user_id', user.id).eq('provider', provider).eq('date', today).maybeSingle()

  let oura = ouraRes.data?.data as OuraData | null
  let verdict = verdictFor(oura)

  // Fallback: if today still has no usable signal (provider lag, sync just
  // failed), use the most recent Oura row from the last few days so the
  // card renders instead of disappearing entirely.
  let usedFallback = false
  if (!verdict) {
    const ouraRecent = await db
      .from('wearable_data').select('data')
      .eq('user_id', user.id).eq('provider', provider).lt('date', today).order('date', { ascending: false }).limit(1).maybeSingle()
    oura = oura ?? (ouraRecent.data?.data as OuraData | null)
    verdict = verdictFor(oura)
    usedFallback = true
  }

  if (!verdict) return NextResponse.json({ noData: true })

  const resolved = await getModelForFeature(user.id, 'coaching')
  if (!resolved) return noKeyResponse(suggestedProviderFor('coaching'))

  const profileBlock = await getProfileBlock(db, user.id, 'home')

  let call: { headline: string; bullets: string[] }
  try {
    call = await generateCall(resolved.model, verdict, oura, profileBlock, provider)
  } catch (err) {
    if (isAiLimitError(err)) return aiLimitResponse()
    throw err
  }
  const { headline, bullets } = call

  // Only cache as "today's" call when it was built from today's data. A
  // fallback-derived call is left uncached so it self-heals once today's data
  // lands, instead of pinning stale data under today's date.
  if (!usedFallback) {
    await db.from('todays_call').upsert(
      { user_id: user.id, date: today, color: verdict, headline, bullets },
      { onConflict: 'user_id,date' },
    )
  }

  return NextResponse.json({ color: verdict, headline, bullets })
}
