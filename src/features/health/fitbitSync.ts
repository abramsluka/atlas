import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { OuraData } from './types'

type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

// Fitbit data is normalized into the OuraData shape at sync time (see
// specs/health/FITBIT_INTEGRATION_SPEC.md) so every consumer renders it with
// zero changes. Rows land in wearable_data with provider='fitbit'.
//
// The one thing that makes Fitbit different from Oura and WHOOP: its Web API
// exposes NO sleep score and NO readiness score (both are app/Premium only).
// Leaving them null would blank the two headline numbers on the card forever,
// which is exactly how the first WHOOP integration died. So both are derived
// here from the same inputs the vendors' own composites use, with the formulas
// below, and flagged `scores_estimated` so the UI labels them.

const FITBIT_API = 'https://api.fitbit.com'
export const FITBIT_TOKEN_URL = 'https://api.fitbit.com/oauth2/token'

// Baseline window for readiness. HRV and skin-temp range endpoints cap at 30
// days; 14 is plenty for a rolling mean and is also the initial backfill.
const BASELINE_DAYS = 14
const MIN_BASELINE_DAYS = 3

interface FitbitSleepLog {
  dateOfSleep: string          // YYYY-MM-DD, the day the sleep ENDED
  startTime: string            // naive local, "2026-09-08T23:12:00.000"
  endTime: string
  duration: number             // ms
  efficiency?: number
  isMainSleep: boolean
  minutesAsleep: number
  minutesAwake: number
  minutesToFallAsleep?: number
  timeInBed: number
  type?: 'stages' | 'classic'
  levels?: {
    summary?: Partial<Record<'deep' | 'light' | 'rem' | 'wake' | 'asleep' | 'restless' | 'awake', { minutes?: number }>>
  }
}
interface DatedValue<T> { dateTime: string; value: T }

export function fitbitBasicAuth(): string {
  return 'Basic ' + Buffer.from(`${process.env.FITBIT_CLIENT_ID}:${process.env.FITBIT_CLIENT_SECRET}`).toString('base64')
}

// Fitbit refresh tokens are SINGLE-USE: "The refresh token can only be used
// once, as a new refresh token is returned with the new access token." Persist
// both immediately or the next sync is locked out, same hazard as WHOOP.
async function refreshFitbitToken(db: DbClient, userId: string, refreshToken: string): Promise<string | null> {
  const res = await fetch(FITBIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: fitbitBasicAuth(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) return null
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 28800) * 1000).toISOString()
  await db.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? refreshToken,
    expires_at: expiresAt,
  }).eq('user_id', userId).eq('provider', 'fitbit')
  return tokens.access_token as string
}

function dayOffset(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + delta * 86_400_000).toISOString().slice(0, 10)
}

// No Accept-Language on purpose: omitting it makes Fitbit return metric, so
// the skin-temperature delta arrives in °C like Oura's temperature_deviation.
async function get<T>(path: string, token: string): Promise<{ json: T | null; status: number }> {
  const res = await fetch(`${FITBIT_API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return { json: null, status: res.status }
  return { json: (await res.json()) as T, status: res.status }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const toNum = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

// Fitbit's endTime is a naive local wall-clock string. plausibleWakeHour reads
// the wall clock straight off an ISO string WITH an offset, so re-emit it as
// the same wall clock plus the user's offset for that instant.
function withOffset(naiveLocal: string, tz: string): string | null {
  try {
    const instant = fromZonedTime(naiveLocal.replace(/\.\d{3}$/, ''), tz)
    if (isNaN(instant.getTime())) return null
    return formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm:ssXXX")
  } catch {
    return null
  }
}

/**
 * Sleep score, 0–100. Stages logs weight duration 50 / efficiency 25 / depth 25,
 * where 8h asleep and 45% of sleep in deep+REM each earn full credit. Classic
 * logs (older trackers, no stages) split duration 65 / efficiency 35.
 */
export function deriveSleepScore(s: FitbitSleepLog): number | null {
  const asleep = s.minutesAsleep
  if (!asleep || asleep <= 0) return null
  const eff = s.efficiency ?? (s.timeInBed > 0 ? Math.round((100 * asleep) / s.timeInBed) : null)
  const effPart = eff != null ? clamp(eff, 0, 100) / 100 : 0.85
  const durPart = Math.min(1, asleep / 480)
  const deep = s.levels?.summary?.deep?.minutes
  const rem = s.levels?.summary?.rem?.minutes
  if (s.type === 'stages' && deep != null && rem != null) {
    const depthPart = Math.min(1, (deep + rem) / (0.45 * asleep))
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

/**
 * Fetch fresh Fitbit data, upsert a normalized row for each of the last
 * `windowDays` days that has any data, and return today's row. Always pulls a
 * 14-day window regardless (six range calls, so the cost is the same) because
 * readiness needs HRV/RHR baselines from prior days. The connect callback
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
    const fresh = await refreshFitbitToken(db, userId, tokenRow.refresh_token)
    if (!fresh) {
      // A rotated-away or revoked refresh token can never recover — drop it so
      // the card falls back to Connect instead of failing forever.
      await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'fitbit')
      return null
    }
    accessToken = fresh
  }

  const span = Math.max(windowDays, BASELINE_DAYS)
  const start = dayOffset(today, -(span - 1))
  const range = `date/${start}/${today}.json`

  const [sleep, hrv, heart, temp, steps, calories] = await Promise.all([
    get<{ sleep: FitbitSleepLog[] }>(`/1.2/user/-/sleep/${range}`, accessToken),
    get<{ hrv: DatedValue<{ dailyRmssd?: number; deepRmssd?: number }>[] }>(`/1/user/-/hrv/${range}`, accessToken),
    get<{ 'activities-heart': DatedValue<{ restingHeartRate?: number }>[] }>(`/1/user/-/activities/heart/${range}`, accessToken),
    get<{ tempSkin: DatedValue<{ nightlyRelative?: number }>[] }>(`/1/user/-/temp/skin/${range}`, accessToken),
    get<{ 'activities-steps': DatedValue<string>[] }>(`/1/user/-/activities/steps/${range}`, accessToken),
    get<{ 'activities-calories': DatedValue<string>[] }>(`/1/user/-/activities/calories/${range}`, accessToken),
  ])
  const all = [sleep, hrv, heart, temp, steps, calories]
  if (all.every((r) => r.status === 401)) {
    await db.from('wearable_tokens').delete().eq('user_id', userId).eq('provider', 'fitbit')
    return null
  }
  // Sleep is the one that matters; if that call failed for a non-auth reason
  // (rate limit, 5xx) there is nothing worth writing over the cached rows.
  if (!sleep.json) return (cached?.data as OuraData | null) ?? null

  // Main sleep per day: the isMainSleep log for its dateOfSleep, else longest.
  // Fitbit already attributes a log to the day it ENDED, which is Atlas's own
  // convention, so no offset arithmetic is needed here.
  const sleepByDay = new Map<string, FitbitSleepLog>()
  for (const s of sleep.json.sleep ?? []) {
    const cur = sleepByDay.get(s.dateOfSleep)
    if (!cur || (s.isMainSleep && !cur.isMainSleep) || (s.isMainSleep === cur.isMainSleep && s.minutesAsleep > cur.minutesAsleep)) {
      sleepByDay.set(s.dateOfSleep, s)
    }
  }
  const byDay = <T,>(rows: DatedValue<T>[] | undefined, pick: (v: T) => number | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) {
      const v = pick(r.value)
      if (v != null) m.set(r.dateTime, v)
    }
    return m
  }
  const hrvByDay = byDay(hrv.json?.hrv, (v) => toNum(v.dailyRmssd))
  const rhrByDay = byDay(heart.json?.['activities-heart'], (v) => toNum(v.restingHeartRate))
  const tempByDay = byDay(temp.json?.tempSkin, (v) => toNum(v.nightlyRelative))
  const stepsByDay = byDay(steps.json?.['activities-steps'], (v) => toNum(v))
  const calsByDay = byDay(calories.json?.['activities-calories'], (v) => toNum(v))

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
    // A day Fitbit has nothing for (tracker off) yields a bare zero-step row
    // from the time series; skip it rather than writing an empty day.
    if (!s && hrvV == null && rhrV == null && !(stepsV && stepsV > 0)) continue

    const hrvBaseline = baselineBefore(hrvByDay, day)
    const rhrBaseline = baselineBefore(rhrByDay, day)
    const sleepScore = s ? deriveSleepScore(s) : null
    const deep = s?.levels?.summary?.deep?.minutes
    const rem = s?.levels?.summary?.rem?.minutes
    const efficiency = s ? (s.efficiency ?? (s.timeInBed > 0 ? Math.round((100 * s.minutesAsleep) / s.timeInBed) : null)) : null

    const data: OuraData = {
      sleep: {
        score: sleepScore,
        score_day: s ? day : null,
        detail_day: s ? day : null,
        total_sleep_duration: s ? s.minutesAsleep * 60 : null,
        average_hrv: hrvV,
        deep_sleep_duration: s?.type === 'stages' && deep != null ? deep * 60 : null,
        rem_sleep_duration: s?.type === 'stages' && rem != null ? rem * 60 : null,
        latency: s?.minutesToFallAsleep != null ? s.minutesToFallAsleep * 60 : null,
        efficiency,
        resting_heart_rate: rhrV,
        bedtime_end: s ? withOffset(s.endTime, tz) : null,
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
        log_type: s?.type ?? null,
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
