import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, AI_LIMIT_MESSAGE } from '@/lib/aiErrors'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'

export const runtime = 'nodejs'
export const maxDuration = 60

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

  const [gymLogsResult, checkinsResult, bodyWeightsResult, volumeLogsResult] = await Promise.all([
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
    db.from('body_weights').select('date_key, weight').eq('user_id', user.id).gte('date_key', fiftySevenDaysAgo).order('date_key', { ascending: true }),
    db.from('gym_logs').select('logged_at, weight, reps').eq('user_id', user.id).gte('logged_at', new Date(Date.now() - 57 * 86400000).toISOString()).order('logged_at', { ascending: true }),
  ])

  const gymLogs = gymLogsResult.data ?? []
  const checkins = checkinsResult.data ?? []
  const bodyWeights = bodyWeightsResult.data ?? []
  const volumeLogs = volumeLogsResult.data ?? []

  const todayCheckin = checkins.find(c => c.date === today)

  // Collect all days with any training activity (gym sets OR evening check-in reporting training)
  const gymDays = new Set(
    gymLogs.map(l => new Date(l.logged_at).toLocaleDateString('en-CA', { timeZone: TZ }))
  )
  const checkinTrainingDays = new Set(
    checkins
      .filter(c => c.evening_actual_training === true)
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
    const evening = checkin?.evening_reflection?.trim() || null
    const didCheckinTrain = checkin?.evening_actual_training === true

    if (hadGym && evening) {
      recentActivity.push(`${label}: lifted + ${evening}`)
    } else if (hadGym) {
      recentActivity.push(`${label}: lifted weights`)
    } else if (evening) {
      recentActivity.push(`${label}: ${evening}`)
    } else if (didCheckinTrain) {
      recentActivity.push(`${label}: trained (no details logged)`)
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

  const devilSystem = `You are a foul-mouthed drill sergeant living in this person's head — the voice of brutal, merciless self-accountability. Training means anything — lifting, climbing, running, whatever. The user explicitly asked you to tear into them, so hold nothing back. Swear freely (fuck, shit, hell, damn — whatever lands). Tell them exactly what happens if they skip: they stay soft, they stay fat, the gut wins, the mirror keeps disappointing them, and every excuse they make today is another week of being the before photo. Make them feel the full cost of doing nothing — body, confidence, self-respect — so viscerally they can't sit still. If they've been slacking, rip into the slacking specifically. If they've been showing up, tell them that stopping now would piss away everything they just built and they'd be a fool to let that happen. This is tough love from someone who refuses to watch them waste their potential — savage, but never genuinely cruel about things they can't control. 5–7 sentences of escalating fire, ending with a direct command to move. No data recitation — pure consequence and identity. Make them feel it.`

  const angelSystem = `You are the voice of genuine, overwhelming belief in this person's head. Training means anything — lifting, climbing, running, whatever gets them moving. Your job is to light them up: make them feel the pull of who they're becoming and why it's worth protecting. Talk about momentum, about what consistency does to a person over months, about the version of themselves they're building one session at a time — stronger, leaner, harder to kill. If they've done something recently, use it: name the streak, the comeback, the discipline, and build on that real momentum — it beats empty hype every time. Paint the picture of where this goes if they keep showing up: the body, the confidence, the energy, the person who walks differently. Be real and specific, never hollow or generic. 5–7 sentences of building fire, ending with a charge to go get today's session. No data recitation — pure fire and forward motion.`

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 450,
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
      } catch (streamErr) {
        console.error('[gym/coach] stream error:', streamErr)
        // A usage/spend cap or rate limit surfaces here mid-stream (the 200 is
        // already sent), so emit the friendly message as text instead of tearing
        // the stream — the coach bubble renders whatever text comes through.
        if (isAiLimitError(streamErr)) {
          controller.enqueue(new TextEncoder().encode(AI_LIMIT_MESSAGE))
        } else {
          controller.error(streamErr)
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
