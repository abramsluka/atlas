import type { OuraData } from './types'

type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

// WHOOP data is normalized into the OuraData shape at sync time (see
// specs/health/WHOOP_INTEGRATION_SPEC.md) so every consumer — health card,
// energy curve, mentor, briefing — renders it with zero changes. Rows land in
// wearable_data with provider='whoop'.

const WHOOP_API = 'https://api.prod.whoop.com/developer/v2'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'

interface Scored { score_state?: string }
interface WhoopSleep extends Scored {
  id: string
  start: string
  end: string
  timezone_offset?: string
  nap: boolean
  score?: {
    stage_summary?: {
      total_light_sleep_time_milli?: number
      total_slow_wave_sleep_time_milli?: number
      total_rem_sleep_time_milli?: number
    }
    sleep_performance_percentage?: number | null
    sleep_efficiency_percentage?: number | null
  } | null
}
interface WhoopRecovery extends Scored {
  cycle_id: number
  sleep_id: string
  score?: {
    recovery_score?: number | null
    resting_heart_rate?: number | null
    hrv_rmssd_milli?: number | null
  } | null
}
interface WhoopCycle extends Scored {
  id: number
  start: string
  end: string | null
  timezone_offset?: string
  score?: { strain?: number | null; kilojoule?: number | null } | null
}

// WHOOP ROTATES refresh tokens: every refresh returns a new refresh_token and
// the old one dies. Persist both immediately or the next sync is locked out.
// `scope=offline` on the refresh is what keeps issuing refresh tokens.
async function refreshWhoopToken(db: DbClient, userId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
      scope: 'offline',
    }),
  })
  if (!res.ok) return null
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  await db.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    expires_at: expiresAt,
  }).eq('user_id', userId).eq('provider', 'whoop')
  return tokens.access_token as string
}

// Local calendar day of an ISO instant using the record's own UTC offset
// ("-07:00"), so days are attributed the way WHOOP's app shows them.
function localDay(iso: string, offset?: string): string {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset ?? '')
  const minutes = m ? (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10)) : 0
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString().slice(0, 10)
}

function dayOffset(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10)
}

async function fetchAll<T>(path: string, headers: HeadersInit, startIso: string, endIso: string): Promise<{ records: T[]; status: number }> {
  const records: T[] = []
  let next: string | undefined
  let status = 200
  do {
    const params = new URLSearchParams({ start: startIso, end: endIso, limit: '25' })
    if (next) params.set('nextToken', next)
    const res = await fetch(`${WHOOP_API}${path}?${params}`, { headers })
    status = res.status
    if (!res.ok) break
    const json = await res.json()
    records.push(...((json.records ?? []) as T[]))
    next = json.next_token ?? undefined
  } while (next)
  return { records, status }
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
const scored = (x?: Scored | null): boolean => x?.score_state === 'SCORED'
const sleepMs = (s: WhoopSleep): number => {
  const st = s.score?.stage_summary
  return (st?.total_light_sleep_time_milli ?? 0) + (st?.total_slow_wave_sleep_time_milli ?? 0) + (st?.total_rem_sleep_time_milli ?? 0)
}

function normalize(day: string, s?: WhoopSleep, r?: WhoopRecovery, c?: WhoopCycle): OuraData {
  const st = s?.score?.stage_summary
  const sws = num(st?.total_slow_wave_sleep_time_milli)
  const rem = num(st?.total_rem_sleep_time_milli)
  const sleepScored = scored(s)
  const recScored = scored(r)
  return {
    sleep: {
      score: sleepScored ? num(s?.score?.sleep_performance_percentage) : null,
      score_day: s ? day : null,
      detail_day: s ? day : null,
      total_sleep_duration: sleepScored && s ? Math.round(sleepMs(s) / 1000) : null,
      average_hrv: recScored ? num(r?.score?.hrv_rmssd_milli) : null,
      deep_sleep_duration: sleepScored && sws != null ? Math.round(sws / 1000) : null,
      rem_sleep_duration: sleepScored && rem != null ? Math.round(rem / 1000) : null,
      latency: null,
      efficiency: sleepScored ? num(s?.score?.sleep_efficiency_percentage) : null,
      resting_heart_rate: recScored ? num(r?.score?.resting_heart_rate) : null,
      bedtime_end: s?.end ?? null,
    },
    readiness: {
      score: recScored ? num(r?.score?.recovery_score) : null,
      temperature_deviation: null,
    },
    activity: {
      steps: null, // WHOOP has no step count; the steps tile prefers Apple Health
      active_calories: null,
      total_calories: c?.score?.kilojoule != null ? Math.round(c.score.kilojoule / 4.184) : null,
      steps_day: c ? day : null,
    },
    whoop: { strain: num(c?.score?.strain) },
  }
}

/**
 * Fetch fresh WHOOP data, upsert a normalized row for every day in the window
 * (that's the backfill — the connect callback passes windowDays=7), and return
 * today's row. Cached today row served if <15 min old unless forced. Returns
 * null with no token, on refresh failure, or when the token is dead (all 401).
 */
export async function syncWhoopToday(
  db: DbClient,
  userId: string,
  today: string,
  force = false,
  windowDays = 3,
): Promise<OuraData | null> {
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', userId).eq('provider', 'whoop').eq('date', today)
    .maybeSingle()
  if (!force && cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    const d = cached.data as OuraData
    if (age < 15 * 60 * 1000 && d?.sleep?.score != null && d.sleep.score_day === today) return d
  }

  const { data: tokenRow } = await db
    .from('wearable_tokens').select('*')
    .eq('user_id', userId).eq('provider', 'whoop')
    .maybeSingle()
  if (!tokenRow) return null

  let accessToken = tokenRow.access_token as string
  if (new Date(tokenRow.expires_at).getTime() <= Date.now() + 60_000) {
    const fresh = await refreshWhoopToken(db, userId, tokenRow.refresh_token)
    if (!fresh) {
      // Dead refresh token (rotated away or revoked) can never recover — drop
      // it so the card falls back to Connect instead of failing forever.
      await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'whoop')
      return null
    }
    accessToken = fresh
  }

  const headers = { Authorization: `Bearer ${accessToken}` }
  const endIso = new Date().toISOString()
  const startIso = new Date(Date.now() - (windowDays + 1) * 86_400_000).toISOString()

  const [sleeps, recoveries, cycles] = await Promise.all([
    fetchAll<WhoopSleep>('/activity/sleep', headers, startIso, endIso),
    fetchAll<WhoopRecovery>('/recovery', headers, startIso, endIso),
    fetchAll<WhoopCycle>('/cycle', headers, startIso, endIso),
  ])
  if ([sleeps, recoveries, cycles].every((r) => r.status === 401)) {
    await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'whoop')
    return null
  }

  // Main sleep per local day = longest non-nap ending that day.
  const sleepByDay = new Map<string, WhoopSleep>()
  for (const s of sleeps.records) {
    if (s.nap || !s.end) continue
    const day = localDay(s.end, s.timezone_offset)
    const cur = sleepByDay.get(day)
    if (!cur || sleepMs(s) > sleepMs(cur)) sleepByDay.set(day, s)
  }
  const sleepById = new Map(sleeps.records.map((s) => [s.id, s]))
  const cycleById = new Map(cycles.records.map((c) => [c.id, c]))

  // Recovery joins its sleep (preferred) or cycle for day attribution.
  const recoveryByDay = new Map<string, WhoopRecovery>()
  for (const r of recoveries.records) {
    const s = sleepById.get(r.sleep_id)
    const c = cycleById.get(r.cycle_id)
    const day = s?.end ? localDay(s.end, s.timezone_offset) : c ? localDay(c.start, c.timezone_offset) : null
    if (day) recoveryByDay.set(day, r)
  }

  // Cycle (strain/calories) keyed by the local day it started; the current
  // open cycle (end null) is today's running total.
  const cycleByDay = new Map<string, WhoopCycle>()
  for (const c of cycles.records) {
    const day = localDay(c.start, c.timezone_offset)
    const cur = cycleByDay.get(day)
    if (!cur || c.end === null || c.start > cur.start) cycleByDay.set(day, c)
  }

  const rows: Array<{ user_id: string; provider: 'whoop'; date: string; data: OuraData; fetched_at: string }> = []
  let todayRow: OuraData | null = null
  const fetchedAt = new Date().toISOString()
  for (let n = 0; n < windowDays; n++) {
    const day = dayOffset(today, -n)
    const s = sleepByDay.get(day)
    const r = recoveryByDay.get(day)
    const c = cycleByDay.get(day)
    if (!s && !r && !c) continue
    const data = normalize(day, s, r, c)
    rows.push({ user_id: userId, provider: 'whoop', date: day, data, fetched_at: fetchedAt })
    if (day === today) todayRow = data
  }
  if (rows.length > 0) {
    await db.from('wearable_data').upsert(rows, { onConflict: 'user_id,provider,date' })
  }
  return todayRow
}
