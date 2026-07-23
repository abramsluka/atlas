// Pure derivation for the Exercise History sheet (specs/gym/EXERCISE_HISTORY_SPEC.md).
// Sets → sessions → chart series + stats + PR detection. No React, unit-testable.
import type { GymExercise, GymLog } from './types'

// ── shared calc (same formulas GymClient uses — keep in lockstep) ───────────

export function logDatePST(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

export function compute1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

// ── timeframes ──────────────────────────────────────────────────────────────

export type Timeframe = 'W' | 'M' | '3M' | '6M' | 'Y' | 'ALL'
export const TIMEFRAMES: Timeframe[] = ['W', 'M', '3M', '6M', 'Y', 'ALL']
export const TIMEFRAME_DAYS: Record<Timeframe, number> = {
  W: 7, M: 30, '3M': 90, '6M': 180, Y: 365, ALL: Infinity,
}
export const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  W: 'past week', M: 'past month', '3M': 'past 3 months',
  '6M': 'past 6 months', Y: 'past year', ALL: 'all time',
}

// ── sessions ────────────────────────────────────────────────────────────────

export interface ExerciseSession {
  dateKey: string        // LA calendar day, YYYY-MM-DD
  date: Date
  sets: GymLog[]         // every set that day, chrono order (incl. swapped)
  topWeight: number      // max weight that day (bodyweight exercises: max reps)
  repsAtTop: number      // best reps achieved at topWeight
  setCount: number
  totalReps: number
  e1rm: number
  deltaWeight: number | null  // topWeight − previous non-swapped session; null = first
  swapped: string | null      // performed_exercise when the whole day was a swap
}

// Group raw set logs into one session per LA day. Swapped sets
// (performed_exercise != null — a travel-day substitute) never drive the
// metrics of the original lift: a day of only swapped sets becomes a
// `swapped` session (greyed table row, excluded from chart/best/deltas).
export function groupSessions(logs: GymLog[], ex: GymExercise): ExerciseSession[] {
  const byDay = new Map<string, GymLog[]>()
  for (const l of logs) {
    const k = logDatePST(l.logged_at)
    const arr = byDay.get(k)
    if (arr) arr.push(l)
    else byDay.set(k, [l])
  }

  const metric = (l: GymLog) => ex.bodyweight ? l.reps : l.weight
  const sessions: ExerciseSession[] = []
  for (const [dateKey, sets] of byDay) {
    sets.sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const own = sets.filter(s => !s.performed_exercise)
    const use = own.length ? own : sets
    const topWeight = Math.max(...use.map(metric))
    const repsAtTop = Math.max(...use.filter(l => metric(l) === topWeight).map(l => l.reps))
    sessions.push({
      dateKey,
      date: new Date(dateKey + 'T12:00:00'),
      sets,
      topWeight,
      repsAtTop,
      setCount: sets.length,
      totalReps: sets.reduce((s, l) => s + l.reps, 0),
      e1rm: Math.max(...use.map(l => compute1RM(l.weight, l.reps))),
      deltaWeight: null,
      swapped: own.length ? null : (sets[0].performed_exercise ?? null),
    })
  }
  sessions.sort((a, b) => a.dateKey.localeCompare(b.dateKey))

  // Session-over-session delta, chained across non-swapped sessions only.
  let prev: ExerciseSession | null = null
  for (const s of sessions) {
    if (s.swapped) continue
    s.deltaWeight = prev ? s.topWeight - prev.topWeight : null
    prev = s
  }
  return sessions
}

// LA date key N days before `now` — window edges compare on calendar days,
// not timestamps, so a session exactly N days ago stays inside the window.
function cutoffKey(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// Non-swapped sessions inside the timeframe window — the chart's series.
export function chartSessions(sessions: ExerciseSession[], tf: Timeframe, now: Date = new Date()): ExerciseSession[] {
  const clean = sessions.filter(s => !s.swapped)
  if (tf === 'ALL') return clean
  const cut = cutoffKey(now, TIMEFRAME_DAYS[tf])
  return clean.filter(s => s.dateKey >= cut)
}

// Caption under the chart: first → last delta of the visible window.
export function windowDelta(visible: ExerciseSession[]): number | null {
  if (visible.length < 2) return null
  return visible[visible.length - 1].topWeight - visible[0].topWeight
}

// Fixed 30-day stat tile: latest top − top as of 30 days ago (latest session
// on/before the cutoff; falls back to the first session inside the window).
export function last30Delta(sessions: ExerciseSession[], now: Date = new Date()): number | null {
  const clean = sessions.filter(s => !s.swapped)
  if (clean.length < 2) return null
  const cut = cutoffKey(now, 30)
  const latest = clean[clean.length - 1]
  const base = [...clean].reverse().find(s => s.dateKey < cut) ?? clean[0]
  if (base === latest) return null
  return latest.topWeight - base.topWeight
}

// ── records ─────────────────────────────────────────────────────────────────

export interface BestRecord {
  weight: number   // heaviest ever lifted (bodyweight exercises: max reps)
  reps: number     // best reps achieved at that weight
  e1rm: number
  dateKey: string
}

export function bestRecord(logs: GymLog[], ex: GymExercise): BestRecord | null {
  const own = logs.filter(l => !l.performed_exercise)
  if (!own.length) return null
  if (ex.bodyweight) {
    const top = own.reduce((b, l) => l.reps > b.reps ? l : b)
    return { weight: top.reps, reps: top.reps, e1rm: top.reps, dateKey: logDatePST(top.logged_at) }
  }
  const maxW = Math.max(...own.map(l => l.weight))
  const top = own.filter(l => l.weight === maxW).reduce((b, l) => l.reps > b.reps ? l : b)
  return {
    weight: maxW,
    reps: top.reps,
    e1rm: Math.max(...own.map(l => compute1RM(l.weight, l.reps))),
    dateKey: logDatePST(top.logged_at),
  }
}

export interface NewBest {
  kind: 'weight' | 'reps'
  weight: number
  reps: number
  prevWeight: number
  prevReps: number
}

// prior = all logs for this exercise BEFORE the new set was inserted.
// First-ever set is a baseline, not a record. Swapped sets never count.
export function detectNewBest(
  prior: GymLog[],
  set: { weight: number; reps: number },
  ex: GymExercise,
): NewBest | null {
  const own = prior.filter(l => !l.performed_exercise)
  if (!own.length) return null
  if (ex.bodyweight) {
    const maxReps = Math.max(...own.map(l => l.reps))
    if (set.reps > maxReps) return { kind: 'reps', weight: 0, reps: set.reps, prevWeight: 0, prevReps: maxReps }
    return null
  }
  const maxW = Math.max(...own.map(l => l.weight))
  if (set.weight > maxW) {
    const prevReps = Math.max(...own.filter(l => l.weight === maxW).map(l => l.reps))
    return { kind: 'weight', weight: set.weight, reps: set.reps, prevWeight: maxW, prevReps }
  }
  if (set.weight === maxW) {
    const repsAtMax = Math.max(...own.filter(l => l.weight === maxW).map(l => l.reps))
    if (set.reps > repsAtMax) return { kind: 'reps', weight: set.weight, reps: set.reps, prevWeight: maxW, prevReps: repsAtMax }
  }
  return null
}

// "Beat it next session: 87.5, or 85 × 6."
export function nextTarget(best: BestRecord, ex: GymExercise): { weightTarget: number; repTarget: number } {
  return { weightTarget: best.weight + (ex.step || 2.5), repTarget: best.reps + 1 }
}

// "Jun 15" from a YYYY-MM-DD dateKey
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtSessionDate(dateKey: string): string {
  const [, m, d] = dateKey.split('-').map(Number)
  return `${MONTHS[(m ?? 1) - 1]} ${d}`
}
