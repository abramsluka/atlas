// ── Energy model — single source of truth ────────────────────────────────────
// Consumed by both the caffeine page (full curve) and the health page compact
// card so the two always read the same number. Do not fork this math.

import type { OuraData, WhoopData } from './types'

// ── Pharmacokinetic + physiological constants ─────────────────────────────────
export const HALF_LIFE_H = 5.5
export const ABSORPTION_TAU = 0.8
export const ADENOSINE_RATE = 1.8
export const CAF_SCALE = 0.24

export interface DosePoint {
  id: string
  hour: number
  mg: number
  source: string
  loggedAt: string
}

export interface WorkoutPoint {
  id: string
  completedHour: number   // local hour (0–24) when workout finished
  volumeLbs: number       // total lifted volume = sum(reps * weight_lbs)
  name: string | null
}

export interface MealPoint {
  id: string
  hour: number            // local hour of meal
  calories: number
  name: string
}

export interface PeakWindow {
  start: number
  end: number
  peak: number
  peakH: number
}

export function caffeineConc(t: number, mg: number): number {
  if (t <= 0) return 0
  const absorption = 1 - Math.exp(-t / ABSORPTION_TAU)
  const decay = Math.exp(-t * Math.LN2 / HALF_LIFE_H)
  return mg * absorption * decay
}

// Natural 1–3pm dip (~−12pts) and 6–9pm second wind (~+15pts)
export function circadianOffset(hour: number): number {
  const afternoonDip = -12 * Math.exp(-0.5 * ((hour - 14) / 1.2) ** 2)
  const eveningWind  =  15 * Math.exp(-0.5 * ((hour - 19) / 1.5) ** 2)
  return afternoonDip + eveningWind
}

// Post-workout endorphin/adrenaline window: starts 30min after finish, fades ~3h
export function workoutBoostAt(hour: number, workouts: WorkoutPoint[]): number {
  return workouts.reduce((sum, w) => {
    const t = hour - (w.completedHour + 0.5) // 30min onset delay
    if (t < 0) return sum
    const intensity = Math.min(1, Math.max(0.2, w.volumeLbs / 10000))
    return sum + 22 * intensity * Math.exp(-t / 2.5)
  }, 0)
}

// Large meals cause a ~45min-peak dip lasting ~2h
export function mealDipAt(hour: number, meals: MealPoint[]): number {
  return meals.reduce((sum, m) => {
    const t = hour - m.hour
    if (t < 0 || t > 3) return sum
    const size = Math.min(1, (m.calories ?? 0) / 800)
    return sum - 7 * size * Math.exp(-0.5 * ((t - 0.75) / 0.6) ** 2)
  }, 0)
}

export function computeEnergy(
  hour: number,
  wakeHour: number,
  sleepQuality: number,
  doses: DosePoint[],
  workouts: WorkoutPoint[] = [],
  meals: MealPoint[] = [],
): number {
  if (hour < wakeHour - 1) return 0
  const hoursAwake = Math.max(0, hour - wakeHour)
  // baseline: readiness 94 → ~82 (High), readiness 75 → ~69, readiness 50 → ~53
  const baseline = 20 + sleepQuality * 0.65
  let cafEnergy = 0
  for (const d of doses) cafEnergy += caffeineConc(hour - d.hour, d.mg) * CAF_SCALE
  const raw = baseline
    + cafEnergy
    + circadianOffset(hour)
    + workoutBoostAt(hour, workouts)
    + mealDipAt(hour, meals)
    - hoursAwake * ADENOSINE_RATE
  return Math.max(0, Math.min(100, raw))
}

export function energyLabel(e: number): string {
  if (e >= 80) return 'Peak'
  if (e >= 65) return 'High'
  if (e >= 50) return 'Moderate'
  if (e >= 35) return 'Low'
  return 'Crash'
}

export function energyColor(e: number): string {
  if (e >= 65) return '#4ade80'
  if (e >= 45) return '#fb923c'
  return '#f87171'
}

// ── Sleep-quality + wake-hour derivation ──────────────────────────────────────
// Both surfaces must feed computeEnergy identical inputs, so derive them here.
function normalizeHrv(hrv: number | null | undefined): number | null {
  if (hrv == null) return null
  return Math.min(100, Math.max(0, (hrv - 20) / 80 * 100))
}

export function deriveSleepQuality(
  ouraData: OuraData | null,
  whoopData: WhoopData | null,
): number {
  // Oura readiness already integrates sleep + HRV + recovery — best single signal
  const ouraReadiness = ouraData?.readiness?.score
  if (ouraReadiness != null) return ouraReadiness
  const ouraScore = ouraData?.sleep?.score
  const ouraHrv = normalizeHrv(ouraData?.sleep?.average_hrv)
  if (ouraScore != null) return ouraHrv != null ? ouraScore * 0.7 + ouraHrv * 0.3 : ouraScore
  const whoopScore = whoopData?.recovery?.score
  const whoopHrv = normalizeHrv(whoopData?.recovery?.hrv_rmssd_milli)
  if (whoopScore != null) return whoopHrv != null ? whoopScore * 0.7 + whoopHrv * 0.3 : whoopScore
  return 75
}

export function deriveWakeHour(ouraData: OuraData | null): number {
  const be = ouraData?.sleep?.bedtime_end
  if (be) {
    const d = new Date(be)
    if (!isNaN(d.getTime())) return d.getHours() + d.getMinutes() / 60
  }
  return 7
}

// ── Dose mapping ──────────────────────────────────────────────────────────────
export function logsToDoses(
  logs: { id: string; logged_at: string; amount_mg: number; source: string }[],
): DosePoint[] {
  return logs
    .map(l => ({
      id: l.id,
      hour: new Date(l.logged_at).getHours() + new Date(l.logged_at).getMinutes() / 60,
      mg: l.amount_mg,
      source: l.source,
      loggedAt: l.logged_at,
    }))
    .sort((a, b) => a.hour - b.hour)
}

// Convenience for the compact card: energy at a given clock hour straight from logs.
export function currentEnergyFromLogs(
  hour: number,
  logs: { id: string; logged_at: string; amount_mg: number; source: string }[],
  ouraData: OuraData | null,
  whoopData: WhoopData | null,
  workouts: WorkoutPoint[] = [],
  meals: MealPoint[] = [],
): number {
  return computeEnergy(
    hour,
    deriveWakeHour(ouraData),
    deriveSleepQuality(ouraData, whoopData),
    logsToDoses(logs),
    workouts,
    meals,
  )
}

// ── Peak windows ──────────────────────────────────────────────────────────────
// Detect genuine local maxima of the energy curve (with prominence so tiny
// wiggles don't register), then build a tight window around the top of each
// bump — not one wide span over everything above a threshold.
const PEAK_STEP = 0.05        // sampling resolution (hours)
const PEAK_MIN_PROMINENCE = 4 // peak must rise this far above its lower flanking valley
const PEAK_WINDOW_DROP = 5    // window spans where energy stays within this of the peak
const PEAK_MIN_VALUE = 55     // ignore peaks below this — not worth calling a "peak window"

export function computePeakWindows(
  wakeHour: number,
  sleepQuality: number,
  doses: DosePoint[],
  workouts: WorkoutPoint[] = [],
  meals: MealPoint[] = [],
  maxWindows = 3,
): PeakWindow[] {
  const startH = wakeHour
  const hours: number[] = []
  const vals: number[] = []
  for (let h = startH; h <= 24 + 1e-9; h += PEAK_STEP) {
    hours.push(h)
    vals.push(computeEnergy(h, wakeHour, sleepQuality, doses, workouts, meals))
  }
  const n = vals.length

  const windows: PeakWindow[] = []
  for (let i = 1; i < n - 1; i++) {
    // local maximum (allow flat-top by requiring strictly greater than the side
    // we descend toward)
    if (!(vals[i] >= vals[i - 1] && vals[i] > vals[i + 1])) continue
    if (vals[i] < PEAK_MIN_VALUE) continue

    // prominence: lowest valley to the nearest higher peak on each side
    let leftMin = vals[i]
    for (let j = i - 1; j >= 0; j--) {
      if (vals[j] > vals[i]) break
      leftMin = Math.min(leftMin, vals[j])
    }
    let rightMin = vals[i]
    for (let j = i + 1; j < n; j++) {
      if (vals[j] > vals[i]) break
      rightMin = Math.min(rightMin, vals[j])
    }
    const prominence = vals[i] - Math.max(leftMin, rightMin)
    if (prominence < PEAK_MIN_PROMINENCE) continue

    // tight window: expand out while energy stays within PEAK_WINDOW_DROP of peak
    const floor = vals[i] - PEAK_WINDOW_DROP
    let lo = i
    while (lo > 0 && vals[lo - 1] >= floor) lo--
    let hi = i
    while (hi < n - 1 && vals[hi + 1] >= floor) hi++

    windows.push({
      start: hours[lo],
      end: hours[hi],
      peak: Math.round(vals[i]),
      peakH: hours[i],
    })
    i = hi // skip past this window's plateau
  }

  // keep the strongest peaks, then present chronologically
  return windows
    .sort((a, b) => b.peak - a.peak)
    .slice(0, maxWindows)
    .sort((a, b) => a.peakH - b.peakH)
}
