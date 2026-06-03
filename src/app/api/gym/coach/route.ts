import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import type { WhoopData } from '@/features/health/types'

export const maxDuration = 30

export async function POST(request: NextRequest) {
  try {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const mode: 'devil' | 'angel' = body.mode === 'angel' ? 'angel' : 'devil'

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const now = new Date()
  const today = formatInTimeZone(now, TZ, 'yyyy-MM-dd')
  const sevenDaysAgo = formatInTimeZone(subDays(now, 7), TZ, 'yyyy-MM-dd')
  const fourteenDaysAgo = formatInTimeZone(subDays(now, 14), TZ, 'yyyy-MM-dd')
  const fiftySevenDaysAgo = formatInTimeZone(subDays(now, 57), TZ, 'yyyy-MM-dd')

  const [gymLogsResult, checkinsResult, whoopWearableRes, bodyWeightsResult, volumeLogsResult] = await Promise.all([
    db
      .from('gym_logs')
      .select('logged_at')
      .eq('user_id', user.id)
      .gte('logged_at', new Date(Date.now() - 14 * 86400000).toISOString())
      .order('logged_at', { ascending: false }),
    db
      .from('daily_checkins')
      .select('date, morning_intent, morning_planned_training, evening_actual_training, evening_reflection')
      .eq('user_id', user.id)
      .gte('date', fourteenDaysAgo)
      .order('date', { ascending: false }),
    db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'whoop').eq('date', today).maybeSingle(),
    db.from('body_weights').select('date_key, weight').eq('user_id', user.id).gte('date_key', fiftySevenDaysAgo).order('date_key', { ascending: true }),
    db.from('gym_logs').select('logged_at, weight, reps').eq('user_id', user.id).gte('logged_at', new Date(Date.now() - 57 * 86400000).toISOString()).order('logged_at', { ascending: true }),
  ])

  const gymLogs = gymLogsResult.data ?? []
  const checkins = checkinsResult.data ?? []
  const whoopToday = whoopWearableRes.data?.data as WhoopData | null
  const bodyWeights = bodyWeightsResult.data ?? []
  const volumeLogs = volumeLogsResult.data ?? []

  const todayCheckin = checkins.find(c => c.date === today)

  // Collect all days with any training activity (gym sets OR evening check-in reporting training)
  const gymDays = new Set(
    gymLogs.map(l => new Date(l.logged_at).toLocaleDateString('en-CA', { timeZone: TZ }))
  )
  const checkinTrainingDays = new Set(
    checkins
      .filter(c => c.evening_actual_training && c.evening_actual_training.trim())
      .map(c => c.date)
  )
  const allTrainingDays = new Set([...gymDays, ...checkinTrainingDays])

  // Days since last any training
  const sortedDays = [...allTrainingDays].sort((a, b) => b.localeCompare(a))
  const lastActiveDay = sortedDays[0]
  const daysSinceLast = lastActiveDay
    ? Math.round((new Date(today).getTime() - new Date(lastActiveDay).getTime()) / 86400000)
    : null

  // Active days this week vs last week
  const activeThisWeek = [...allTrainingDays].filter(d => d >= sevenDaysAgo && d <= today).length
  const activeLastWeek = [...allTrainingDays].filter(d => d >= fourteenDaysAgo && d < sevenDaysAgo).length

  // Build context
  const lines: string[] = []

  // Recent activity log (last 7 days) — what they actually did each day
  const recentActivity: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = formatInTimeZone(subDays(now, i), TZ, 'yyyy-MM-dd')
    const label = i === 0 ? 'Today' : i === 1 ? 'Yesterday' : formatInTimeZone(subDays(now, i), TZ, 'EEE MMM d')
    const checkin = checkins.find(c => c.date === d)
    const hadGym = gymDays.has(d)
    const evening = checkin?.evening_actual_training?.trim()

    if (hadGym && evening) {
      recentActivity.push(`${label}: lifted + ${evening}`)
    } else if (hadGym) {
      recentActivity.push(`${label}: lifted weights`)
    } else if (evening) {
      recentActivity.push(`${label}: ${evening}`)
    } else if (i < 5) {
      recentActivity.push(`${label}: nothing logged`)
    }
  }

  if (recentActivity.length) {
    lines.push('Recent activity:\n' + recentActivity.map(l => `  ${l}`).join('\n'))
  }

  lines.push(`Active days this week: ${activeThisWeek}. Last week: ${activeLastWeek}.`)

  if (daysSinceLast === null) {
    lines.push('Has never logged any training.')
  } else if (daysSinceLast === 0) {
    lines.push('Already trained today.')
  } else if (daysSinceLast === 1) {
    lines.push('Last trained yesterday.')
  } else {
    lines.push(`Has not trained in ${daysSinceLast} days.`)
  }

  if (todayCheckin?.morning_intent) {
    lines.push(`What they said they wanted to do today: "${todayCheckin.morning_intent}".`)
  }

  if (whoopToday) {
    const whoopLines: string[] = []
    if (whoopToday.recovery?.score != null) whoopLines.push(`Recovery: ${whoopToday.recovery.score}%`)
    if (whoopToday.cycle?.strain != null) whoopLines.push(`Strain: ${whoopToday.cycle.strain.toFixed(1)}/21`)
    if (whoopToday.cycle?.kilojoule != null) whoopLines.push(`Calories burned: ${Math.round(whoopToday.cycle.kilojoule * 0.239)} kcal`)
    if (whoopLines.length > 0) lines.push(`Whoop today — ${whoopLines.join(', ')}.`)
  }

  // Body composition context — gate on 4+ weight logs and 4+ training sessions
  const distinctTrainingSessions = new Set(
    volumeLogs
      .filter(l => l.logged_at)
      .map(l => new Date(l.logged_at!).toLocaleDateString('en-CA', { timeZone: TZ }))
  ).size

  if (bodyWeights.length >= 4 && distinctTrainingSessions >= 4) {
    const firstBw = bodyWeights[0]
    const lastBw = bodyWeights[bodyWeights.length - 1]
    const daySpan = Math.max(1, (new Date(lastBw.date_key).getTime() - new Date(firstBw.date_key).getTime()) / 86400000)
    const weeklyChange = ((lastBw.weight - firstBw.weight) / daySpan) * 7

    // Volume per week (sum weight*reps grouped into 7-day buckets)
    const volumeByWeek: Record<string, number> = {}
    for (const log of volumeLogs) {
      if (!log.logged_at || !log.weight || !log.reps) continue
      const date = new Date(log.logged_at)
      const weekStart = new Date(date)
      weekStart.setDate(date.getDate() - date.getDay())
      const key = weekStart.toISOString().slice(0, 10)
      volumeByWeek[key] = (volumeByWeek[key] ?? 0) + (log.weight * log.reps)
    }
    const weekKeys = Object.keys(volumeByWeek).sort()
    const recentVolume = weekKeys.slice(-2).map(k => `${k}: ${Math.round(volumeByWeek[k]).toLocaleString()} lbs lifted`)

    const trendDesc = Math.abs(weeklyChange) < 0.3
      ? 'stable (maintaining)'
      : weeklyChange < 0
        ? `losing ~${Math.abs(weeklyChange).toFixed(1)} lbs/week (cutting)`
        : `gaining ~${weeklyChange.toFixed(1)} lbs/week (bulking)`

    lines.push(
      `\nBody weight trend (last ${bodyWeights.length} logs over ${Math.round(daySpan)} days): ${firstBw.weight} → ${lastBw.weight} lbs. Currently ${trendDesc}.`,
      recentVolume.length ? `Recent weekly volume: ${recentVolume.join(', ')}.` : '',
    )
  }

  const context = lines.join('\n')

  const devilSystem = `You are the voice of brutal self-accountability in this person's head. Training means anything — lifting, climbing, running, whatever. Your job is one thing: make them feel the cost of doing nothing so viscerally they can't ignore it. Talk about what happens to their body, their confidence, their self-image when they stop showing up. Be raw, be uncomfortable, be real — not mean for the sake of it, but the kind of hard truth a person needs to hear when they're deciding whether to move. If they've been active recently, push them to keep the streak alive. 2–3 sentences. No data recitation — pure consequence and identity. Make them feel it.`

  const angelSystem = `You are the voice of genuine belief in this person's head. Training means anything — lifting, climbing, running, whatever gets them moving. Your job is to make them feel the pull of who they're becoming and why it's worth protecting. Talk about momentum, about what consistency does to a person over time, about the version of themselves they're building one session at a time. If they've done something recently, use that — real momentum beats empty hype. Be real, not hollow. 2–3 sentences. No data recitation — pure fire and forward motion.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: mode === 'devil' ? devilSystem : angelSystem,
    messages: [
      { role: 'user', content: `My training data:\n\n${context}` },
    ],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
  } catch (err) {
    console.error('[gym/coach] unhandled error:', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
