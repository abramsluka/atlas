import type { OuraData } from './types'

type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

interface CacheRow {
  date: string
  data: OuraData
}

function formatSleep(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h${m}m`
}

function avg(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

export async function getOuraContextRange(
  db: DbClient,
  userId: string,
  startDate: string,
  endDate: string,
): Promise<CacheRow[]> {
  const { data } = await db
    .from('wearable_data')
    .select('date, data')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  return (data ?? []) as CacheRow[]
}

/**
 * Build a short recovery summary string for AI coach prompts.
 * Returns null when no Oura data is available so the prompt can skip the section entirely.
 */
export function summarizeOuraForCoach(rows: CacheRow[]): string | null {
  if (rows.length === 0) return null

  // Find the most recent row with any real data
  const latest = rows.find(r =>
    r.data?.readiness?.score != null ||
    r.data?.sleep?.score != null ||
    r.data?.sleep?.average_hrv != null,
  )

  if (!latest) return null

  const lines: string[] = []
  const s = latest.data

  const readiness = s.readiness?.score
  const sleepScore = s.sleep?.score
  const sleepDur = s.sleep?.total_sleep_duration
  const hrv = s.sleep?.average_hrv
  const deep = s.sleep?.deep_sleep_duration
  const rem = s.sleep?.rem_sleep_duration
  const latency = s.sleep?.latency
  const rhr = s.sleep?.resting_heart_rate
  const tempDev = s.readiness?.temperature_deviation

  lines.push(
    `Most recent (${latest.date}): readiness ${readiness ?? '?'}, sleep score ${sleepScore ?? '?'}, slept ${formatSleep(sleepDur)}, HRV ${hrv != null ? Math.round(hrv) + 'ms' : '?'}, deep ${formatSleep(deep)}, REM ${formatSleep(rem)}, latency ${latency != null ? Math.round(latency / 60) + 'min' : '?'}, RHR ${rhr != null ? Math.round(rhr) + 'bpm' : '?'}${tempDev != null ? `, temp deviation ${tempDev >= 0 ? '+' : ''}${tempDev.toFixed(2)}°C` : ''}`,
  )

  if (rows.length >= 3) {
    const readinessAvg = avg(rows.map(r => r.data?.readiness?.score))
    const sleepScoreAvg = avg(rows.map(r => r.data?.sleep?.score))
    const hrvAvg = avg(rows.map(r => r.data?.sleep?.average_hrv))
    lines.push(
      `${rows.length}-day avg: readiness ${readinessAvg != null ? Math.round(readinessAvg) : '?'}, sleep score ${sleepScoreAvg != null ? Math.round(sleepScoreAvg) : '?'}, HRV ${hrvAvg != null ? Math.round(hrvAvg) + 'ms' : '?'}`,
    )
  }

  return lines.join('\n')
}

/**
 * Find the Oura row matching a specific date (e.g. for a journal entry).
 * Returns null if no row exists.
 */
export async function getOuraForDate(
  db: DbClient,
  userId: string,
  date: string,
): Promise<OuraData | null> {
  const { data } = await db
    .from('wearable_data')
    .select('data')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .eq('date', date)
    .maybeSingle()
  return (data?.data as OuraData) ?? null
}

export function summarizeOuraForDate(data: OuraData | null): string | null {
  if (!data) return null
  const r = data.readiness?.score
  const s = data.sleep?.score
  const dur = data.sleep?.total_sleep_duration
  const hrv = data.sleep?.average_hrv
  if (r == null && s == null && dur == null && hrv == null) return null
  return `readiness ${r ?? '?'}, sleep score ${s ?? '?'}, slept ${formatSleep(dur)}, HRV ${hrv != null ? Math.round(hrv) + 'ms' : '?'}`
}
