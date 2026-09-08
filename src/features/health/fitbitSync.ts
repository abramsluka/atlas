import { formatInTimeZone } from 'date-fns-tz'
import type { OuraData } from './types'

type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

// Fitbit data via the GOOGLE HEALTH API. The legacy Fitbit Web API is turned
// off on 2026-09-30; Google Health is its replacement (Google OAuth, REST at
// health.googleapis.com/v4). Rows still land in wearable_data with
// provider='fitbit' — the device is a Fitbit, the transport is Google — and are
// normalized into the OuraData shape so every consumer renders them unchanged
// (see specs/health/FITBIT_INTEGRATION_SPEC.md).
//
// Neither the old nor the new API exposes a sleep score or a readiness score
// (both are app/Premium only). Leaving them null would blank the two headline
// numbers on the card forever, which is how the first WHOOP integration died.
// So both are derived here from the same inputs the vendors' own composites
// use, with the formulas below, and flagged `scores_estimated` so the UI says so.

const HEALTH_API = 'https://health.googleapis.com/v4/users/me/dataTypes'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
]

// Baseline window for readiness. Also the hard cap the API puts on a
// total-calories dailyRollUp range, so the sync never fetches more than this.
const BASELINE_DAYS = 14
const MIN_BASELINE_DAYS = 3

// ── Google Health API shapes (from the v4 discovery document) ───────────────
interface GDate { year: number; month: number; day: number }
interface CivilDateTime { date: GDate; time?: { hours?: number; minutes?: number; seconds?: number } }
interface StageSummary { type: 'AWAKE' | 'LIGHT' | 'DEEP' | 'REM' | 'ASLEEP' | 'RESTLESS' | string; minutes?: string; count?: string }
interface GSleep {
  interval: {
    startTime: string
    endTime: string
    startUtcOffset?: string   // "-14400s"
    endUtcOffset?: string
    civilEndTime?: CivilDateTime
  }
  type?: 'CLASSIC' | 'STAGES' | string
  metadata?: { mainSleep?: boolean; nap?: boolean; processed?: boolean }
  summary?: {
    minutesAsleep?: string
    minutesAwake?: string
    minutesToFallAsleep?: string
    minutesInSleepPeriod?: string
    stagesSummary?: StageSummary[]
  }
}
interface GDataPoint {
  name?: string
  sleep?: GSleep
  dailyRestingHeartRate?: { date: GDate; beatsPerMinute?: string }
  dailyHeartRateVariability?: { date: GDate; averageHeartRateVariabilityMilliseconds?: number }
  dailySleepTemperatureDerivations?: { date: GDate; nightlyTemperatureCelsius?: number; baselineTemperatureCelsius?: number }
}
interface GRollup { civilStartTime?: CivilDateTime; steps?: { countSum?: string }; totalCalories?: { kcalSum?: number } }

// Sleep as the scorer sees it, independent of which API produced it.
export interface SleepFacts {
  minutesAsleep: number
  minutesInBed: number | null
  minutesToFallAsleep: number | null
  deepMinutes: number | null
  remMinutes: number | null
  hasStages: boolean
}

// ── Google OAuth ───────────────────────────────────────────────────────────
// Google refresh tokens do NOT rotate: the refresh response carries only a new
// access token (~1h), and the refresh token stays valid until revoked, unused
// for 6 months, or the consent screen is left in "Testing" (7-day expiry — the
// setup notes insist on publishing to production for exactly this reason).
async function refreshGoogleToken(db: DbClient, userId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) return null
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3599) * 1000).toISOString()
  await db.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    expires_at: expiresAt,
  }).eq('user_id', userId).eq('provider', 'fitbit')
  return tokens.access_token as string
}

// ── helpers ─────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const gdate = (d?: GDate | null): string | null =>
  d?.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null
const toGDate = (day: string): GDate => {
  const [y, m, d] = day.split('-').map(Number)
  return { year: y, month: m, day: d }
}
function dayOffset(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10)
}

// Google gives an instant plus the wearer's UTC offset in seconds ("-14400s").
// plausibleWakeHour reads the wall clock straight off an ISO string that
// carries an offset, so re-emit the instant as local wall clock + that offset.
// Falls back to the Atlas timezone only when the record has no offset.
function localIso(instant: string, utcOffset: string | undefined, tz: string): string | null {
  const t = new Date(instant)
  if (isNaN(t.getTime())) return null
  const secs = utcOffset ? parseInt(utcOffset.replace(/s$/, ''), 10) : NaN
  if (Number.isFinite(secs)) {
    const local = new Date(t.getTime() + secs * 1000).toISOString().slice(0, 19)
    const sign = secs < 0 ? '-' : '+'
    const abs = Math.abs(secs)
    const hh = String(Math.floor(abs / 3600)).padStart(2, '0')
    const mm = String(Math.floor((abs % 3600) / 60)).padStart(2, '0')
    return `${local}${sign}${hh}:${mm}`
  }
  try {
    return formatInTimeZone(t, tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
  } catch {
    return null
  }
}

async function apiGet<T>(path: string, token: string): Promise<{ json: T | null; status: number }> {
  const res = await fetch(`${HEALTH_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { json: null, status: res.status }
  return { json: (await res.json()) as T, status: res.status }
}
async function apiPost<T>(path: string, token: string, body: unknown): Promise<{ json: T | null; status: number }> {
  const res = await fetch(`${HEALTH_API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { json: null, status: res.status }
  return { json: (await res.json()) as T, status: res.status }
}

// list() with the daily-summary date filter, following nextPageToken.
async function listDaily(dataType: string, filterField: string, start: string, endExclusive: string, token: string) {
  const points: GDataPoint[] = []
  let status = 200
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      filter: `${filterField} >= "${start}" AND ${filterField} < "${endExclusive}"`,
      pageSize: '100',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const r = await apiGet<{ dataPoints?: GDataPoint[]; nextPageToken?: string }>(`/${dataType}/dataPoints?${params}`, token)
    status = r.status
    if (!r.json) break
    points.push(...(r.json.dataPoints ?? []))
    pageToken = r.json.nextPageToken || undefined
  } while (pageToken)
  return { points, status }
}

// dailyRollUp over a closed-open civil date range, one bucket per day.
async function rollupDaily(dataType: string, start: string, endExclusive: string, token: string) {
  const r = await apiPost<{ rollupDataPoints?: GRollup[] }>(`/${dataType}/dataPoints:dailyRollUp`, token, {
    range: { start: { date: toGDate(start) }, end: { date: toGDate(endExclusive) } },
    windowSizeDays: 1,
  })
  return { points: r.json?.rollupDataPoints ?? [], status: r.status }
}

// ── derived scores ──────────────────────────────────────────────────────────
/**
 * Sleep score, 0–100. Stages sleeps weight duration 50 / efficiency 25 / depth
 * 25, where 8h asleep and 45% of sleep in deep+REM each earn full credit.
 * Classic sleeps (older trackers, no stages) split duration 65 / efficiency 35.
 */
export function deriveSleepScore(s: SleepFacts): number | null {
  const asleep = s.minutesAsleep
  if (!asleep || asleep <= 0) return null
  const eff = s.minutesInBed && s.minutesInBed > 0 ? Math.round((100 * asleep) / s.minutesInBed) : null
  const effPart = eff != null ? clamp(eff, 0, 100) / 100 : 0.85
  const durPart = Math.min(1, asleep / 480)
  if (s.hasStages && s.deepMinutes != null && s.remMinutes != null) {
    const depthPart = Math.min(1, (s.deepMinutes + s.remMinutes) / (0.45 * asleep))
    return Math.round(50 * durPart + 25 * effPart + 25 * depthPart)
  }
  return Math.round(65 * durPart + 35 * effPart)
}

/**
 * Readiness, 0–100, null without a sleep score. Starts from sleep (0.6·score +
 * 30, so a perfect night is 90 before adjustments), then ±15 each for HRV and
 * resting HR against the rolling baseline, and −10 when skin temperature runs
 * more than 0.5 °C above baseline, which is the illness signal Oura also uses.
 * With no baseline yet it is purely sleep-driven, which is the honest
 * degradation for the first few days.
 */
export function deriveReadiness(args: {
  sleepScore: number | null
  hrv: number | null
  hrvBaseline: number | null
  rhr: number | null
  rhrBaseline: number | null
  tempDelta: number | null
}): number | null {
  const { sleepScore, hrv, hrvBaseline, rhr, rhrBaseline, tempDelta } = args
  if (sleepScore == null) return null
  const hrvAdj = hrv != null && hrvBaseline ? clamp((hrv - hrvBaseline) / hrvBaseline, -0.3, 0.3) * 50 : 0
  const rhrAdj = rhr != null && rhrBaseline ? clamp((rhrBaseline - rhr) / rhrBaseline, -0.15, 0.15) * 100 : 0
  const tempAdj = tempDelta != null && tempDelta > 0.5 ? -10 : 0
  return clamp(Math.round(0.6 * sleepScore + 30 + hrvAdj + rhrAdj + tempAdj), 0, 100)
}

function sleepFacts(s: GSleep): SleepFacts {
  const sum = s.summary
  const stage = (t: string) => toNum(sum?.stagesSummary?.find((x) => x.type === t)?.minutes)
  const hasStages = s.type === 'STAGES'
  return {
    minutesAsleep: toNum(sum?.minutesAsleep) ?? 0,
    minutesInBed: toNum(sum?.minutesInSleepPeriod),
    minutesToFallAsleep: toNum(sum?.minutesToFallAsleep),
    deepMinutes: hasStages ? stage('DEEP') : null,
    remMinutes: hasStages ? stage('REM') : null,
    hasStages,
  }
}

// The civil day the sleep ENDED — the morning you woke up — which is Atlas's
// own convention. Prefer the API's civil end (it already applied the wearer's
// offset); fall back to computing it from endTime + endUtcOffset.
function sleepDay(s: GSleep): string | null {
  const civil = gdate(s.interval.civilEndTime?.date)
  if (civil) return civil
  const iso = localIso(s.interval.endTime, s.interval.endUtcOffset, 'UTC')
  return iso ? iso.slice(0, 10) : null
}

/**
 * Fetch fresh data from the Google Health API, upsert a normalized row for
 * each of the last `windowDays` days that has any data, and return today's row.
 * Always pulls a 14-day window regardless (six calls either way) because
 * readiness needs HRV/RHR baselines from prior days; the connect callback
 * passes windowDays=14 so the history chart is populated on landing.
 *
 * Cached today row served if <15 min old unless forced. Returns null with no
 * token, on refresh failure, or when the token is dead (all endpoints 401).
 */
export async function syncFitbitToday(
  db: DbClient,
  userId: string,
  today: string,
  tz: string,
  force = false,
  windowDays = 3,
): Promise<OuraData | null> {
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', userId).eq('provider', 'fitbit').eq('date', today)
    .maybeSingle()
  if (!force && cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    const d = cached.data as OuraData
    if (age < 15 * 60 * 1000 && d?.sleep?.score != null && d.sleep.score_day === today) return d
  }

  const { data: tokenRow } = await db
    .from('wearable_tokens').select('*')
    .eq('user_id', userId).eq('provider', 'fitbit')
    .maybeSingle()
  if (!tokenRow) return null

  let accessToken = tokenRow.access_token as string
  if (new Date(tokenRow.expires_at).getTime() <= Date.now() + 60_000) {
    const fresh = await refreshGoogleToken(db, userId, tokenRow.refresh_token)
    if (!fresh) {
      // Revoked, expired (Testing-mode 7-day tokens) or otherwise dead — drop it
      // so the card falls back to Connect instead of failing forever.
      await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'fitbit')
      return null
    }
    accessToken = fresh
  }

  const span = Math.min(Math.max(windowDays, BASELINE_DAYS), BASELINE_DAYS)
  const start = dayOffset(today, -(span - 1))
  const endExclusive = dayOffset(today, 1)

  const [sleep, rhr, hrv, temp, steps, calories] = await Promise.all([
    listDaily('sleep', 'sleep.interval.civil_end_time', start, endExclusive, accessToken),
    listDaily('daily-resting-heart-rate', 'daily_resting_heart_rate.date', start, endExclusive, accessToken),
    listDaily('daily-heart-rate-variability', 'daily_heart_rate_variability.date', start, endExclusive, accessToken),
    listDaily('daily-sleep-temperature-derivations', 'daily_sleep_temperature_derivations.date', start, endExclusive, accessToken),
    rollupDaily('steps', start, endExclusive, accessToken),
    rollupDaily('total-calories', start, endExclusive, accessToken),
  ])
  const all = [sleep, rhr, hrv, temp, steps, calories]
  if (all.every((r) => r.status === 401)) {
    await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'fitbit')
    return null
  }
  // Sleep is the one that matters; if that call failed for a non-auth reason
  // (quota, 5xx) there is nothing worth writing over the cached rows.
  if (sleep.status !== 200) return (cached?.data as OuraData | null) ?? null

  // Main sleep per day: the API's mainSleep flag wins, else the longest.
  const sleepByDay = new Map<string, GSleep>()
  for (const p of sleep.points) {
    const s = p.sleep
    if (!s?.interval?.endTime) continue
    const day = sleepDay(s)
    if (!day) continue
    const cur = sleepByDay.get(day)
    const isMain = !!s.metadata?.mainSleep
    const curMain = !!cur?.metadata?.mainSleep
    const asleep = toNum(s.summary?.minutesAsleep) ?? 0
    const curAsleep = toNum(cur?.summary?.minutesAsleep) ?? 0
    if (!cur || (isMain && !curMain) || (isMain === curMain && asleep > curAsleep)) sleepByDay.set(day, s)
  }
  const rhrByDay = new Map<string, number>()
  for (const p of rhr.points) {
    const day = gdate(p.dailyRestingHeartRate?.date); const v = toNum(p.dailyRestingHeartRate?.beatsPerMinute)
    if (day && v != null) rhrByDay.set(day, v)
  }
  const hrvByDay = new Map<string, number>()
  for (const p of hrv.points) {
    const day = gdate(p.dailyHeartRateVariability?.date); const v = toNum(p.dailyHeartRateVariability?.averageHeartRateVariabilityMilliseconds)
    if (day && v != null) hrvByDay.set(day, v)
  }
  // Skin temperature arrives as absolute nightly + baseline; Oura's field is the
  // deviation, so store nightly − baseline (°C — the API is metric-only here).
  const tempByDay = new Map<string, number>()
  for (const p of temp.points) {
    const t = p.dailySleepTemperatureDerivations
    const day = gdate(t?.date); const n = toNum(t?.nightlyTemperatureCelsius); const b = toNum(t?.baselineTemperatureCelsius)
    if (day && n != null && b != null) tempByDay.set(day, Math.round((n - b) * 100) / 100)
  }
  const stepsByDay = new Map<string, number>()
  for (const r of steps.points) {
    const day = gdate(r.civilStartTime?.date); const v = toNum(r.steps?.countSum)
    if (day && v != null) stepsByDay.set(day, v)
  }
  const calsByDay = new Map<string, number>()
  for (const r of calories.points) {
    const day = gdate(r.civilStartTime?.date); const v = toNum(r.totalCalories?.kcalSum)
    if (day && v != null) calsByDay.set(day, v)
  }

  // Rolling baseline = mean of the prior days in the window that have a value.
  const baselineBefore = (m: Map<string, number>, day: string): number | null => {
    const prior = [...m.entries()].filter(([d]) => d < day).map(([, v]) => v)
    return prior.length >= MIN_BASELINE_DAYS ? Math.round(mean(prior) * 10) / 10 : null
  }

  const rows: Array<{ user_id: string; provider: 'fitbit'; date: string; data: OuraData; fetched_at: string }> = []
  let todayRow: OuraData | null = null
  const fetchedAt = new Date().toISOString()
  for (let n = 0; n < windowDays; n++) {
    const day = dayOffset(today, -n)
    const s = sleepByDay.get(day)
    const stepsV = stepsByDay.get(day) ?? null
    const calsV = calsByDay.get(day) ?? null
    const hrvV = hrvByDay.get(day) ?? null
    const rhrV = rhrByDay.get(day) ?? null
    const tempV = tempByDay.get(day) ?? null
    // A day with nothing but a zero-step rollup (tracker off) is not worth a row.
    if (!s && hrvV == null && rhrV == null && !(stepsV && stepsV > 0)) continue

    const facts = s ? sleepFacts(s) : null
    const hrvBaseline = baselineBefore(hrvByDay, day)
    const rhrBaseline = baselineBefore(rhrByDay, day)
    const sleepScore = facts ? deriveSleepScore(facts) : null
    const efficiency = facts?.minutesInBed && facts.minutesInBed > 0
      ? Math.round((100 * facts.minutesAsleep) / facts.minutesInBed) : null

    const data: OuraData = {
      sleep: {
        score: sleepScore,
        score_day: s ? day : null,
        detail_day: s ? day : null,
        total_sleep_duration: facts ? facts.minutesAsleep * 60 : null,
        average_hrv: hrvV,
        deep_sleep_duration: facts?.deepMinutes != null ? facts.deepMinutes * 60 : null,
        rem_sleep_duration: facts?.remMinutes != null ? facts.remMinutes * 60 : null,
        latency: facts?.minutesToFallAsleep != null ? facts.minutesToFallAsleep * 60 : null,
        efficiency,
        resting_heart_rate: rhrV,
        bedtime_end: s ? localIso(s.interval.endTime, s.interval.endUtcOffset, tz) : null,
      },
      readiness: {
        score: deriveReadiness({ sleepScore, hrv: hrvV, hrvBaseline, rhr: rhrV, rhrBaseline, tempDelta: tempV }),
        temperature_deviation: tempV,
      },
      activity: {
        steps: stepsV != null ? Math.round(stepsV) : null,
        active_calories: null,
        total_calories: calsV != null ? Math.round(calsV) : null,
        steps_day: stepsV != null ? day : null,
      },
      fitbit: {
        scores_estimated: true,
        log_type: facts ? (facts.hasStages ? 'stages' : 'classic') : null,
        hrv_baseline: hrvBaseline,
        rhr_baseline: rhrBaseline,
      },
    }
    rows.push({ user_id: userId, provider: 'fitbit', date: day, data, fetched_at: fetchedAt })
    if (day === today) todayRow = data
  }
  if (rows.length > 0) {
    await db.from('wearable_data').upsert(rows, { onConflict: 'user_id,provider,date' })
  }
  return todayRow
}
