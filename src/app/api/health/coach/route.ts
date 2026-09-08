import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { streamText } from 'ai'
import { getModelForFeature, suggestedProviderFor } from '@/lib/aiProvider'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, AI_LIMIT_MESSAGE } from '@/lib/aiErrors'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getOuraContextRange } from '@/features/health/ouraContext'
import { syncOuraToday } from '@/features/health/ouraSync'
import type { OuraData } from '@/features/health/types'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (!nums.length) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function fmtSleep(seconds: number | null | undefined): string {
  if (seconds == null) return '?'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m}m`
}

function fmtTimeOfDay(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')}${ampm}`
}

export async function POST(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const now = new Date()
  const today = toLocalDate(TZ)
  const sevenDaysAgo = formatInTimeZone(subDays(now, 7), TZ, 'yyyy-MM-dd')
  const fourteenDaysAgo = formatInTimeZone(subDays(now, 14), TZ, 'yyyy-MM-dd')
  const thirtyDaysAgo = formatInTimeZone(subDays(now, 30), TZ, 'yyyy-MM-dd')

  // Ensure today's Oura cache is fresh before building context
  await syncOuraToday(db, user.id, today)

  const [
    ouraRows,
    supplementsResult,
    supplementLogsResult,
    caffeineResult,
    waterResult,
    profileResult,
    gymLogsResult,
  ] = await Promise.all([
    getOuraContextRange(db, user.id, thirtyDaysAgo, today),
    db.from('supplements').select('*').eq('user_id', user.id).eq('active', true).order('created_at'),
    db.from('supplement_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo),
    db.from('caffeine_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo).order('logged_at'),
    db.from('water_logs').select('*').eq('user_id', user.id).gte('date', sevenDaysAgo),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_logs')
      .select('logged_at, weight, reps, exercise_id, gym_exercises(name)')
      .eq('user_id', user.id)
      .gte('logged_at', subDays(now, 7).toISOString())
      .order('logged_at', { ascending: true }),
  ])


  const supplements = supplementsResult.data ?? []
  const supplementLogs = supplementLogsResult.data ?? []
  const caffeineLogs = caffeineResult.data ?? []
  const waterLogs = waterResult.data ?? []
  const profile = profileResult.data
  type GymLogRow = { logged_at: string; weight: number | null; reps: number | null; exercise_id: string; gym_exercises: { name: string } | null }
  const gymLogs = (gymLogsResult.data ?? []) as unknown as GymLogRow[]

  // Build the body / Oura block — last 7 days shown per-day, 30-day baseline computed separately
  const recentOuraRows = ouraRows.filter(r => r.date >= sevenDaysAgo)
  const ouraLines: string[] = []
  if (ouraRows.length > 0) {
    // Baseline comparisons using full 30-day window
    const baselineHrv = avg(ouraRows.map(r => (r.data as OuraData)?.sleep?.average_hrv))
    const recentHrv = avg(recentOuraRows.map(r => (r.data as OuraData)?.sleep?.average_hrv))
    const baselineReadiness = avg(ouraRows.map(r => (r.data as OuraData)?.readiness?.score))
    const recentReadiness = avg(recentOuraRows.map(r => (r.data as OuraData)?.readiness?.score))

    if (ouraRows.length >= 14 && baselineHrv != null && recentHrv != null) {
      const hrvDelta = Math.round(recentHrv - baselineHrv)
      const sign = hrvDelta >= 0 ? '+' : ''
      ouraLines.push(`  HRV baseline (${ouraRows.length}-day avg): ${Math.round(baselineHrv)}ms | Last 7-day avg: ${Math.round(recentHrv)}ms (${sign}${hrvDelta}ms vs baseline)`)
    }
    if (ouraRows.length >= 14 && baselineReadiness != null && recentReadiness != null) {
      const rDelta = Math.round(recentReadiness - baselineReadiness)
      const sign = rDelta >= 0 ? '+' : ''
      ouraLines.push(`  Readiness baseline (${ouraRows.length}-day avg): ${Math.round(baselineReadiness)} | Last 7-day avg: ${Math.round(recentReadiness)} (${sign}${rDelta} vs baseline)`)
    }

    for (const row of recentOuraRows) {
      const d = row.data as OuraData
      ouraLines.push(
        `  ${row.date}: readiness ${d.readiness?.score ?? '?'}, sleep score ${d.sleep?.score ?? '?'}, slept ${fmtSleep(d.sleep?.total_sleep_duration)}, latency ${d.sleep?.latency != null ? Math.round(d.sleep.latency / 60) + 'min' : '?'}, deep ${fmtSleep(d.sleep?.deep_sleep_duration)}, REM ${fmtSleep(d.sleep?.rem_sleep_duration)}, HRV ${d.sleep?.average_hrv != null ? Math.round(d.sleep.average_hrv) + 'ms' : '?'}, RHR ${d.sleep?.resting_heart_rate != null ? Math.round(d.sleep.resting_heart_rate) + 'bpm' : '?'}`,
      )
    }
  }

  function logDateTZ(utcStr: string): string {
    return formatInTimeZone(new Date(utcStr), TZ, 'yyyy-MM-dd')
  }

  // Training load — group gym logs by user's local date, compute volume per day
  const trainingByDay = new Map<string, { exercises: Set<string>; volume: number }>()
  for (const log of gymLogs) {
    const dk = logDateTZ(log.logged_at)
    const entry = trainingByDay.get(dk) ?? { exercises: new Set(), volume: 0 }
    entry.exercises.add(log.gym_exercises?.name ?? 'Unknown')
    if (log.weight != null && log.reps != null) entry.volume += log.weight * log.reps
    trainingByDay.set(dk, entry)
  }
  // Fill in all 7 days (including rest days)
  const trainingLines: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dk = formatInTimeZone(d, TZ, 'yyyy-MM-dd')
    const entry = trainingByDay.get(dk)
    if (entry) {
      const names = [...entry.exercises].join(', ')
      const vol = entry.volume > 0 ? `, ${entry.volume.toLocaleString()} lbs volume` : ''
      trainingLines.push(`  ${dk}: trained — ${names} (${entry.exercises.size} exercise${entry.exercises.size !== 1 ? 's' : ''}${vol})`)
    } else {
      trainingLines.push(`  ${dk}: no training logged`)
    }
  }

  // Supplement summary + recent-change detection
  const fourteenAgoDate = new Date(fourteenDaysAgo + 'T00:00:00')
  const recentlyAdded = supplements.filter(s => new Date(s.created_at) >= fourteenAgoDate)
  const supplementLines: string[] = []
  for (const s of supplements) {
    const logCount = supplementLogs.filter(l => l.supplement_id === s.id).length
    const slots = (s.times ?? []).length || 1
    const expected = slots * 7
    const recent = new Date(s.created_at) >= fourteenAgoDate
    supplementLines.push(
      `  - ${s.name}${s.dose ? ' ' + s.dose : ''} (${(s.times ?? []).join('/') || 'anytime'}): logged ${logCount}/${expected} times this week${recent ? ` — ADDED ${Math.round((Date.now() - new Date(s.created_at).getTime()) / (24 * 60 * 60 * 1000))} days ago` : ''}`,
    )
  }

  // Caffeine — flag late-day intake which is the high-signal one
  const caffeineByDay = new Map<string, Array<{ time: string; mg: number; source: string }>>()
  for (const log of caffeineLogs) {
    const arr = caffeineByDay.get(log.date) ?? []
    arr.push({ time: fmtTimeOfDay(log.logged_at), mg: log.amount_mg, source: log.source })
    caffeineByDay.set(log.date, arr)
  }
  const caffeineLines: string[] = []
  for (const [date, entries] of [...caffeineByDay.entries()].sort()) {
    const total = entries.reduce((a, b) => a + b.mg, 0)
    const detail = entries.map(e => `${e.source} ${e.mg}mg @ ${e.time}`).join(', ')
    caffeineLines.push(`  ${date}: ${total}mg total — ${detail}`)
  }

  // Water — total per day vs target
  const target = profile?.daily_water_target_oz ?? null
  const waterByDay = new Map<string, number>()
  for (const log of waterLogs) {
    waterByDay.set(log.date, (waterByDay.get(log.date) ?? 0) + log.amount_oz)
  }
  const waterLines: string[] = []
  for (const [date, total] of [...waterByDay.entries()].sort()) {
    waterLines.push(`  ${date}: ${Math.round(total)}oz${target ? ` / ${target}oz target` : ''}`)
  }

  const userMessage = [
    'Last 7 days of my health data:',
    '',
    ouraLines.length > 0 ? `Body data (Oura, by day):\n${ouraLines.join('\n')}` : 'Body data: not connected or empty',
    '',
    `Training load (last 7 days):\n${trainingLines.join('\n')}`,
    '',
    supplementLines.length > 0 ? `Supplement stack:\n${supplementLines.join('\n')}` : 'Supplement stack: empty',
    recentlyAdded.length > 0 ? `\nNote: ${recentlyAdded.map(s => s.name).join(', ')} ${recentlyAdded.length === 1 ? 'was' : 'were'} added in the last 14 days — comment specifically on whether the body data shows any change since the addition.` : '',
    '',
    caffeineLines.length > 0 ? `Caffeine intake:\n${caffeineLines.join('\n')}` : 'Caffeine intake: none logged',
    '',
    waterLines.length > 0 ? `Water intake:\n${waterLines.join('\n')}` : 'Water intake: none logged',
  ].filter(Boolean).join('\n')

  // Provider-agnostic: honors the user's "coaching" preference (Claude, GPT or
  // Gemini) and falls back to whichever key they actually hold.
  const resolved = await getModelForFeature(user.id, 'coaching')
  if (!resolved) return noKeyResponse(suggestedProviderFor('coaching'))

  const profileBlock = await getProfileBlock(db, user.id, 'food')

  const result = streamText({
    model: resolved.model,
    maxOutputTokens: 500,
    system: `You are Atlas, a personal health coach. The user is sharing the last 7 days of their wearable, supplement, caffeine, hydration, and training data. Cross-reference everything and give direct, specific, observation-driven feedback in 4–6 sentences. Priorities:

1. Training load vs recovery. If the user trained hard and readiness dropped the next day, name it with the numbers. If they haven't trained in 3+ days and readiness is still low, that's worth noting. Cross-reference training days with the Oura readiness for the following day.
2. HRV and readiness vs baseline. If a baseline is provided and the recent week is notably below it, name the gap and what might be driving it.
3. Caffeine timing vs sleep latency and deep sleep. If they had caffeine after 2pm and that night their latency was elevated or deep sleep was short, name it specifically with the numbers.
4. Supplement adherence vs sleep / HRV. If they're consistent on a supplement and HRV is up, say so. If they're missing doses, call it out.
5. Recently added supplements: compare body data before and after the addition. Honest read — is it doing anything visible yet?
6. Hydration only if there's a clear pattern.

Be specific with numbers. Don't list — write a tight paragraph. No bullet points, no headers. Don't cheerlead. If the data is too thin to draw conclusions, say that.${profileBlock ? `\n\n${profileBlock}` : ''}`,
    messages: [{ role: 'user', content: userMessage }],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) {
          controller.enqueue(new TextEncoder().encode(chunk))
        }
      } catch (err) {
        if (isAiLimitError(err)) {
          controller.enqueue(new TextEncoder().encode(AI_LIMIT_MESSAGE))
        } else {
          throw err
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
}
