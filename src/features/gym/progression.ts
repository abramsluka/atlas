// Progressive-overload engine.
//
// Deliberately split into two halves so the deciding half is a pure function of
// numbers — no Supabase, no React, no await — and can be tested with fake data:
//
//   buildSessionHistory()  raw set logs → one normalized SessionPerf per day
//   decideProgression()    SessionPerf[] + spec → Prescription
//
// Why it was rewritten: the old rule read only the LAST set of the last session
// and compared its reps to rep_min. Two failures fall out of that.
//
//   1. 120 × 9, 8, 7 is a good session — reps fade inside a session from
//      fatigue, not weakness — but the old rule saw "7 < 8" and told you to
//      drop the weight. Set one is the honest measure of capacity.
//   2. It never read the weight column. 115 × 12 in April and 145 × 7 in June
//      averages to "9.5 reps, hold", when it is actually an 11% e1RM gain.
//      Reps alone cannot answer the question, so no threshold tuning fixes it.
//
// Everything here trends on `perf` (estimated 1RM, or reps for bodyweight
// lifts), which is comparable across different loads. Rep zones only choose the
// *kind* of nudge once the trend has already said whether you are getting
// stronger.
import type { GymExercise, GymLog, PrescriptionAction } from './types'
import { compute1RM, logDatePST } from './history'

// ── inputs ──────────────────────────────────────────────────────────────────

export interface ProgressionSpec {
  repMin: number
  repMax: number
  step: number
  bodyweight: boolean
  units: string
}

export interface ProgressionContext {
  now?: Date
  /** Oura readiness 0–100. When low, a weight jump is softened, never forced. */
  readiness?: number | null
}

export function specFromExercise(ex: GymExercise, units = 'lbs'): ProgressionSpec {
  const repMin = ex.rep_min || 6
  return {
    repMin,
    repMax: ex.rep_max && ex.rep_max > repMin ? ex.rep_max : repMin + 2,
    step: ex.step || 2.5,
    bodyweight: ex.bodyweight,
    units,
  }
}

// ── stage 1: prep ───────────────────────────────────────────────────────────

export interface PerfSet {
  weight: number
  reps: number
}

/** One training day, normalized into numbers the decision half can compare. */
export interface SessionPerf {
  dateKey: string
  daysAgo: number
  sets: PerfSet[]
  /** Heaviest load touched that day (bodyweight lifts: always 0). */
  topWeight: number
  /** Best reps achieved at topWeight. */
  topSetReps: number
  /** The load that actually carried the session: most sets, ties go heavier. */
  workWeight: number
  workSets: number
  /** Reps at workWeight in the order they were performed. */
  workReps: number[]
  avgWorkReps: number
  bestWorkReps: number
  lastWorkReps: number
  /** Fraction of reps lost first → last set at workWeight. null with <2 sets. */
  fatigueDrop: number | null
  volume: number
  /** The trend metric. e1RM for loaded lifts, best reps for bodyweight. */
  perf: number
}

/** LA calendar days between two YYYY-MM-DD keys. */
function dayGap(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T12:00:00Z`)
  const b = Date.parse(`${toKey}T12:00:00Z`)
  return Math.round((b - a) / 86400000)
}

/**
 * Raw set logs → one SessionPerf per training day, oldest first.
 * Swapped sets (a travel-day substitute movement) are dropped: a dumbbell
 * press must never drive the barbell press's progression.
 */
export function buildSessionHistory(
  logs: GymLog[],
  spec: ProgressionSpec,
  now: Date = new Date(),
): SessionPerf[] {
  const own = logs.filter(l => !l.performed_exercise)
  if (!own.length) return []

  const byDay = new Map<string, GymLog[]>()
  for (const l of own) {
    const k = logDatePST(l.logged_at)
    const arr = byDay.get(k)
    if (arr) arr.push(l)
    else byDay.set(k, [l])
  }

  const todayKey = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const out: SessionPerf[] = []

  for (const [dateKey, raw] of byDay) {
    raw.sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const sets: PerfSet[] = raw.map(l => ({ weight: spec.bodyweight ? 0 : l.weight, reps: l.reps }))

    const topWeight = Math.max(...sets.map(s => s.weight))
    const topSetReps = Math.max(...sets.filter(s => s.weight === topWeight).map(s => s.reps))

    // Working load = the weight carrying the most sets. A single heavy single
    // shouldn't outrank three working sets, so ties break toward the heavier.
    const counts = new Map<number, number>()
    for (const s of sets) counts.set(s.weight, (counts.get(s.weight) ?? 0) + 1)
    let workWeight = topWeight
    let bestCount = 0
    for (const [w, c] of counts) {
      if (c > bestCount || (c === bestCount && w > workWeight)) {
        workWeight = w
        bestCount = c
      }
    }

    const workReps = sets.filter(s => s.weight === workWeight).map(s => s.reps)
    const first = workReps[0]
    const last = workReps[workReps.length - 1]

    out.push({
      dateKey,
      daysAgo: dayGap(dateKey, todayKey),
      sets,
      topWeight,
      topSetReps,
      workWeight,
      workSets: workReps.length,
      workReps,
      avgWorkReps: workReps.reduce((s, r) => s + r, 0) / workReps.length,
      bestWorkReps: Math.max(...workReps),
      lastWorkReps: last,
      fatigueDrop: workReps.length >= 2 && first > 0 ? (first - last) / first : null,
      volume: sets.reduce((s, x) => s + (spec.bodyweight ? x.reps : x.weight * x.reps), 0),
      perf: spec.bodyweight
        ? Math.max(...sets.map(s => s.reps))
        : Math.max(...sets.map(s => compute1RM(s.weight, s.reps))),
    })
  }

  out.sort((a, b) => a.dateKey.localeCompare(b.dateKey))
  return out
}

// ── trend ───────────────────────────────────────────────────────────────────

export type TrendDirection = 'rising' | 'flat' | 'falling'

export interface TrendSummary {
  /** How many sessions the slope was fit over. */
  window: number
  direction: TrendDirection
  /** Least-squares slope as a % of the window mean, per session. */
  pctPerSession: number
  /** First → last change across the window, %. */
  pctChange: number
  bestPerf: number
  bestDateKey: string
  /** The latest session set an all-time perf best. */
  newBest: boolean
}

/** Below this much %/session the trend is noise, not direction. */
const FLAT_BAND = 0.5

export function perfTrend(sessions: SessionPerf[], window = 6): TrendSummary | null {
  if (sessions.length < 2) return null
  const w = sessions.slice(-window)
  const n = w.length
  const meanX = (n - 1) / 2
  const meanY = w.reduce((s, x) => s + x.perf, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (w[i].perf - meanY)
    den += (i - meanX) ** 2
  }
  const slope = den ? num / den : 0
  const pctPerSession = meanY ? (slope / meanY) * 100 : 0

  const best = sessions.reduce((b, s) => (s.perf > b.perf ? s : b))
  const latest = sessions[sessions.length - 1]

  return {
    window: n,
    direction: pctPerSession >= FLAT_BAND ? 'rising' : pctPerSession <= -FLAT_BAND ? 'falling' : 'flat',
    pctPerSession,
    pctChange: w[0].perf ? ((w[n - 1].perf - w[0].perf) / w[0].perf) * 100 : 0,
    bestPerf: best.perf,
    bestDateKey: best.dateKey,
    newBest: latest.perf >= best.perf && sessions.length > 1,
  }
}

// ── signals ─────────────────────────────────────────────────────────────────

/**
 * Rep zones tile the number line with no gaps and no overlaps. Written as an
 * ordered cascade on purpose: "8 to 12" reads friendly to a human and leaves
 * both 8 and 12 undefined to a machine.
 */
export type RepZone = 'below' | 'in' | 'ceiling'

export function repZone(avgReps: number, spec: ProgressionSpec): RepZone {
  if (avgReps >= spec.repMax) return 'ceiling'
  if (avgReps >= spec.repMin) return 'in'
  return 'below'
}

export interface ProgressionSignals {
  sessionCount: number
  daysSinceLast: number
  workWeight: number
  /** Consecutive most-recent sessions at the current working weight. */
  sessionsAtWeight: number
  justIncreased: boolean
  justDecreased: boolean
  /**
   * Consecutive most-recent sessions whose TOP set missed rep_min. The top set
   * is the capacity measure, so this counts real failures — not sessions that
   * merely ended with a tired third set.
   */
  sessionsBelowFloor: number
  topSetReps: number
  avgWorkReps: number
  fatigueDrop: number | null
  repZone: RepZone
  /** % change in perf vs the previous session. */
  perfVsPrevPct: number | null
  /** Sessions since the all-time perf best (0 = the latest one is the best). */
  sessionsSinceBest: number
  volumeVsPrevPct: number | null
}

export function progressionSignals(sessions: SessionPerf[], spec: ProgressionSpec): ProgressionSignals {
  const latest = sessions[sessions.length - 1]
  const prev = sessions[sessions.length - 2] ?? null

  let sessionsAtWeight = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].workWeight !== latest.workWeight) break
    sessionsAtWeight++
  }

  let sessionsBelowFloor = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].topSetReps >= spec.repMin) break
    sessionsBelowFloor++
  }

  let bestIdx = 0
  for (let i = 1; i < sessions.length; i++) if (sessions[i].perf > sessions[bestIdx].perf) bestIdx = i

  return {
    sessionCount: sessions.length,
    daysSinceLast: latest.daysAgo,
    workWeight: latest.workWeight,
    sessionsAtWeight,
    justIncreased: !!prev && latest.workWeight > prev.workWeight,
    justDecreased: !!prev && latest.workWeight < prev.workWeight,
    sessionsBelowFloor,
    topSetReps: latest.topSetReps,
    avgWorkReps: latest.avgWorkReps,
    fatigueDrop: latest.fatigueDrop,
    repZone: repZone(latest.avgWorkReps, spec),
    perfVsPrevPct: prev?.perf ? ((latest.perf - prev.perf) / prev.perf) * 100 : null,
    sessionsSinceBest: sessions.length - 1 - bestIdx,
    volumeVsPrevPct: prev?.volume ? ((latest.volume - prev.volume) / prev.volume) * 100 : null,
  }
}

// ── stage 2: decide ─────────────────────────────────────────────────────────

export type ProgressionFlag =
  | 'low-data'
  | 'layoff'
  | 'new-weight'
  | 'fatigue-normal'
  | 'fatigue-high'
  | 'stalled'
  | 'regression'
  | 'new-best'
  | 'readiness-low'
  | 'volume-down'
  | 'jump-too-big'

export interface Prescription {
  action: PrescriptionAction
  /** Legacy one-liner, mirrors `headline`. */
  reason: string
  nextWeight?: number
  /** The call, in a phrase. */
  headline: string
  /** What happened → why it reads that way → what to do. 1–3 lines. */
  detail: string[]
  /** Concrete prescription for the next session. */
  target: { weight: number; reps: number } | null
  confidence: 'high' | 'medium' | 'low'
  flags: ProgressionFlag[]
  signals: ProgressionSignals
  trend: TrendSummary | null
}

const DELOAD_STALL_SESSIONS = 4
const REGRESSION_PCT = -5
// Epley overestimates e1RM at high rep counts, so a 12-rep set compared to a
// 7-rep set shows a paper drop that isn't real. Overreach is judged on how far
// the reps landed outside the training range, with the e1RM drop only as
// corroboration at a deliberately extreme threshold.
const OVERREACH_PCT = -12
const OVERREACH_REPS_BELOW_MIN = 2
const LAYOFF_DAYS = 21
const LONG_LAYOFF_DAYS = 45
const HIGH_FATIGUE_DROP = 0.34
const LOW_READINESS = 60

function roundToStep(weight: number, step: number): number {
  const s = step || 2.5
  return Math.max(s, Math.round(weight / s) * s)
}

/** 122.5 → "122.5", 120.0 → "120" */
function fmt(n: number): string {
  return Number(n.toFixed(2)).toString()
}

function setsLabel(reps: number[], weight: number, spec: ProgressionSpec): string {
  return spec.bodyweight ? `${reps.join(', ')} reps` : `${fmt(weight)}${spec.units} × ${reps.join(', ')}`
}

/**
 * The whole decision, as a pure function of normalized sessions.
 *
 * Order matters — each branch is a guard the later ones may assume is false:
 *   layoff → thin data → at ceiling → grace after a jump → stall → regression
 *   → in range → below range.
 */
export function decideProgression(
  sessions: SessionPerf[],
  spec: ProgressionSpec,
  ctx: ProgressionContext = {},
): Prescription | null {
  if (!sessions.length) return null

  const latest = sessions[sessions.length - 1]
  const prev = sessions[sessions.length - 2] ?? null
  const trend = perfTrend(sessions)
  const S = progressionSignals(sessions, spec)
  const u = spec.units
  const bw = spec.bodyweight
  const w = latest.workWeight
  const flags: ProgressionFlag[] = []

  if (S.fatigueDrop != null && S.fatigueDrop >= HIGH_FATIGUE_DROP) flags.push('fatigue-high')
  else if (S.fatigueDrop != null && S.fatigueDrop > 0) flags.push('fatigue-normal')
  if (trend?.newBest) flags.push('new-best')
  if (S.volumeVsPrevPct != null && S.volumeVsPrevPct <= -25) flags.push('volume-down')

  const lastLine = `Last session: ${setsLabel(latest.workReps, w, spec)}.`

  function make(
    action: PrescriptionAction,
    headline: string,
    detail: string[],
    opts: {
      nextWeight?: number
      target?: { weight: number; reps: number } | null
      confidence?: 'high' | 'medium' | 'low'
      flags?: ProgressionFlag[]
    } = {},
  ): Prescription {
    return {
      action,
      reason: headline,
      nextWeight: opts.nextWeight,
      headline,
      detail: detail.filter(Boolean),
      target: opts.target === undefined ? { weight: w, reps: Math.max(spec.repMin, latest.bestWorkReps + 1) } : opts.target,
      confidence: opts.confidence ?? 'high',
      flags: [...flags, ...(opts.flags ?? [])],
      signals: S,
      trend,
    }
  }

  // 1. Layoff — time off is not weakness. Work back up, never punish the return.
  if (S.daysSinceLast >= LAYOFF_DAYS) {
    const pct = S.daysSinceLast >= LONG_LAYOFF_DAYS ? 0.8 : 0.9
    const back = bw ? 0 : roundToStep(w * pct, spec.step)
    return make(
      'REPEAT',
      bw ? `${S.daysSinceLast} days off — ease back in` : `${S.daysSinceLast} days off — restart at ${fmt(back)}${u}`,
      [
        `Last set of ${bw ? 'this' : `${fmt(w)}${u}`} was ${S.daysSinceLast} days ago.`,
        'Strength comes back faster than it was built, but the first session back is for reconnecting, not testing.',
        bw
          ? `Aim for ${Math.max(1, Math.round(latest.bestWorkReps * pct))} reps and rebuild from there.`
          : `Open at ${fmt(back)}${u}. If it moves clean for ${spec.repMax}, you're back at ${fmt(w)}${u} inside two sessions.`,
      ],
      {
        nextWeight: bw ? undefined : back,
        target: { weight: back, reps: bw ? Math.max(1, Math.round(latest.bestWorkReps * pct)) : spec.repMax },
        confidence: 'medium',
        flags: ['layoff'],
      },
    )
  }

  // 2. One session is a data point, not a trend. Nudge, don't commit.
  if (sessions.length === 1) {
    const zone = S.repZone
    if (zone === 'ceiling') {
      const next = bw ? 0 : roundToStep(w + spec.step, spec.step)
      return make(
        'INCREASE',
        bw ? `${latest.bestWorkReps} reps — add load or reps` : `Take it to ${fmt(next)}${u}`,
        [lastLine, `You averaged ${S.avgWorkReps.toFixed(1)} against a ${spec.repMax} ceiling on the very first session, so the weight is light.`, 'One session in — expect a rep drop after the jump; that is the trade, not a setback.'],
        { nextWeight: bw ? undefined : next, target: { weight: next, reps: spec.repMin }, confidence: 'low' },
      )
    }
    return make(
      zone === 'in' ? 'HOLD' : 'REPEAT',
      zone === 'in' ? 'Baseline set — repeat it' : 'Baseline set — build here',
      [lastLine, 'One session is a data point, not a trend. Log this weight again before changing anything.', `Target ${spec.repMin}–${spec.repMax} reps across your sets.`],
      { confidence: 'low', flags: ['low-data'] },
    )
  }

  // 3. Ceiling — the honest earned-it case.
  if (S.repZone === 'ceiling') {
    if (bw) {
      return make(
        'INCREASE',
        `${latest.bestWorkReps} reps — add resistance`,
        [lastLine, `Averaging ${S.avgWorkReps.toFixed(1)} reps past a ${spec.repMax} ceiling means bodyweight alone stopped being the stimulus.`, 'Add a band, a vest, or slow the eccentric to 3 seconds and reset the rep target.'],
        { target: { weight: 0, reps: latest.bestWorkReps + 1 } },
      )
    }
    // Every working set at or above the ceiling, with room to spare → double jump.
    const crushing = latest.workReps.every(r => r >= spec.repMax) && S.avgWorkReps >= spec.repMax + 1.5
    const bump = crushing ? spec.step * 2 : spec.step
    const next = roundToStep(w + bump, spec.step)

    if (ctx.readiness != null && ctx.readiness < LOW_READINESS) {
      return make(
        'HOLD',
        `Earned the jump — bank it for tomorrow`,
        [lastLine, `${S.avgWorkReps.toFixed(1)} average reps clears the ${spec.repMax} ceiling, so ${fmt(next)}${u} is yours.`, `Readiness is ${Math.round(ctx.readiness)} though. Repeat ${fmt(w)}${u} today and take the jump on a rested day — a missed PR costs more than a delayed one.`],
        { target: { weight: w, reps: latest.bestWorkReps }, confidence: 'medium', flags: ['readiness-low'] },
      )
    }

    return make(
      'INCREASE',
      `Add ${fmt(bump)}${u} → ${fmt(next)}${u}`,
      [
        lastLine,
        crushing
          ? `Every set cleared ${spec.repMax} and you averaged ${S.avgWorkReps.toFixed(1)}. That is not a ${fmt(spec.step)}${u} problem — take the double jump.`
          : `Average ${S.avgWorkReps.toFixed(1)} reps at a ${spec.repMax} ceiling. The load is done teaching you anything.`,
        `Expect ${spec.repMin}–${spec.repMin + 1} reps at ${fmt(next)}${u}. That drop is the point, not a regression — the engine will hold you there until you climb back.`,
      ],
      { nextWeight: next, target: { weight: next, reps: spec.repMin }, confidence: trend?.direction === 'falling' ? 'medium' : 'high' },
    )
  }

  // 4. Grace after a jump. Reps drop by design when the bar gets heavier —
  //    dropping back immediately is the yo-yo that keeps lifters at one weight
  //    forever. The only exception is a jump that was genuinely too big.
  if (S.justIncreased && prev) {
    const wayShort = latest.topSetReps < spec.repMin - OVERREACH_REPS_BELOW_MIN
    const perfCollapsed = S.perfVsPrevPct != null && S.perfVsPrevPct <= OVERREACH_PCT && latest.topSetReps < spec.repMin
    if (wayShort || perfCollapsed) {
      // Put the bar where your rep floor actually lives, derived from the e1RM
      // you just demonstrated — not blindly back to the last weight, which may
      // itself have been too light.
      const fromE1RM = roundToStep(latest.perf / (1 + spec.repMin / 30), spec.step)
      const back = Math.max(spec.step, Math.min(fromE1RM, roundToStep(w - spec.step, spec.step)))
      return make(
        'DROP',
        `Jump overshot — ${fmt(back)}${u} is your range`,
        [
          lastLine,
          `${fmt(w)}${u} gave you ${latest.topSetReps} reps against a ${spec.repMin}–${spec.repMax} target. That's a different lift — you trained max strength, not the quality this slot is for.`,
          `Your top set implies a ${Math.round(latest.perf)}${u} single, which puts ${spec.repMin} reps at about ${fmt(back)}${u}. Start there and climb by ${fmt(spec.step)}${u}.`,
        ],
        { nextWeight: back, target: { weight: back, reps: spec.repMin }, flags: ['jump-too-big'] },
      )
    }
    const gained = S.perfVsPrevPct != null && S.perfVsPrevPct > 0
    return make(
      'REPEAT',
      `New weight — stay at ${fmt(w)}${u}`,
      [
        lastLine,
        gained
          ? `Reps are down but estimated 1RM is up ${S.perfVsPrevPct!.toFixed(0)}% on ${fmt(prev.workWeight)}${u} × ${prev.bestWorkReps}. Fewer reps at more weight is progress; the rep count alone would have lied to you.`
          : `First session at ${fmt(w)}${u}. Reps always fall after a jump — that is the cost of the load, not a failure.`,
        `Give this weight 2–3 sessions. Next target: ${Math.min(spec.repMax, latest.bestWorkReps + 1)} on your top set.`,
      ],
      { target: { weight: w, reps: Math.min(spec.repMax, latest.bestWorkReps + 1) }, flags: ['new-weight'] },
    )
  }

  // 5. Real stall — same load for a month of sessions, no new best, going nowhere.
  if (
    S.sessionsAtWeight >= DELOAD_STALL_SESSIONS &&
    S.sessionsSinceBest >= DELOAD_STALL_SESSIONS &&
    S.sessionsBelowFloor >= 3 &&
    trend?.direction !== 'rising' &&
    S.repZone === 'below'
  ) {
    const deload = bw ? 0 : roundToStep(w * 0.9, spec.step)
    return make(
      'DELOAD',
      bw ? 'Stalled — reset the stimulus' : `Stalled — reset at ${fmt(deload)}${u}`,
      [
        `${S.sessionsAtWeight} sessions at ${bw ? 'this' : `${fmt(w)}${u}`} with no new best in ${S.sessionsSinceBest}.`,
        `Reps are averaging ${S.avgWorkReps.toFixed(1)} against a ${spec.repMin} floor and the trend is ${trend?.direction ?? 'flat'}. Grinding the same weight a fifth time will not break this.`,
        bw
          ? 'Cut a set, add 30 seconds of rest, and rebuild volume for two weeks.'
          : `Drop to ${fmt(deload)}${u} for two sessions, own ${spec.repMax} clean reps, then climb back. You will pass ${fmt(w)}${u} faster than you would by grinding it.`,
      ],
      { nextWeight: bw ? undefined : deload, target: { weight: deload, reps: spec.repMax }, flags: ['stalled'] },
    )
  }

  // 6. Regression — two sessions of falling output, not one bad day.
  const prevPrev = sessions[sessions.length - 3] ?? null
  const twoDown =
    !!prev && !!prevPrev && prev.perf < prevPrev.perf && S.perfVsPrevPct != null && S.perfVsPrevPct <= REGRESSION_PCT
  if (twoDown && S.repZone === 'below' && !bw) {
    const down = roundToStep(w - spec.step, spec.step)
    return make(
      'DROP',
      `Two sessions down — back to ${fmt(down)}${u}`,
      [
        lastLine,
        `Estimated 1RM is down ${Math.abs(S.perfVsPrevPct!).toFixed(0)}% and this is the second session falling in a row, so it is not one bad night's sleep.`,
        `Reset to ${fmt(down)}${u}, rebuild to ${spec.repMax} reps, and check what is upstream — sleep, food, or a lift earlier in the session eating this one.`,
      ],
      { nextWeight: down, target: { weight: down, reps: spec.repMax }, flags: ['regression'] },
    )
  }

  // 7. In range — the "keep pushing" case, tuned by which way the trend points.
  if (S.repZone === 'in') {
    const nextRep = Math.min(spec.repMax, Math.max(latest.bestWorkReps + 1, Math.ceil(S.avgWorkReps) + 1))
    const toGo = projectSessionsToIncrease(sessions, spec)

    if (trend?.direction === 'rising') {
      return make(
        'HOLD',
        `Keep pushing at ${bw ? 'this' : `${fmt(w)}${u}`}`,
        [
          lastLine,
          `Top set ${S.topSetReps}, average ${S.avgWorkReps.toFixed(1)} — inside your ${spec.repMin}–${spec.repMax} window, and estimated 1RM is climbing ${trend.pctPerSession.toFixed(1)}% a session.${flags.includes('fatigue-normal') ? ' The fade across sets is fatigue, not weakness; set one is the honest number.' : ''}`,
          `Chase ${nextRep} on your top set.${toGo != null ? ` At this rate ${bw ? 'the next level' : `${fmt(roundToStep(w + spec.step, spec.step))}${u}`} is about ${toGo} session${toGo === 1 ? '' : 's'} away.` : ''}`,
        ],
        { target: { weight: w, reps: nextRep } },
      )
    }

    // Reaching here means the trend is not rising — the branch above returned.
    if (S.sessionsAtWeight >= 3) {
      return make(
        'HOLD',
        `In range but flat — change a variable`,
        [
          lastLine,
          `${S.sessionsAtWeight} sessions at ${bw ? 'this' : `${fmt(w)}${u}`} and the trend is ${trend?.direction ?? 'flat'}. Reps are fine, the stimulus is not.`,
          `Pick one lever and only one: rest 3 minutes instead of 2, add a fourth set, or slow the lowering to 3 seconds. Then chase ${nextRep} on set one.`,
        ],
        { target: { weight: w, reps: nextRep }, confidence: 'medium', flags: ['stalled'] },
      )
    }

    return make(
      'HOLD',
      `Hold ${bw ? 'here' : `${fmt(w)}${u}`} — chase ${nextRep}`,
      [
        lastLine,
        `Top set ${S.topSetReps}, average ${S.avgWorkReps.toFixed(1)} — right inside ${spec.repMin}–${spec.repMax}.${flags.includes('fatigue-high') ? ' The drop-off across sets is steep, so rest longer between them.' : ''}`,
        `Same weight next session. ${nextRep} on set one is the whole job.`,
      ],
      { target: { weight: w, reps: nextRep } },
    )
  }

  // 8. Below range. The old engine dropped the weight here on reflex. Most of
  //    the time that is wrong: the top set tells you whether the weight is
  //    actually too heavy or you just ran out of gas partway through.
  if (S.topSetReps >= spec.repMin) {
    return make(
      'HOLD',
      `Top set was in range — hold ${bw ? 'here' : `${fmt(w)}${u}`}`,
      [
        lastLine,
        `Set one hit ${S.topSetReps}, at or above your ${spec.repMin} floor. The average fell to ${S.avgWorkReps.toFixed(1)} because later sets faded${S.fatigueDrop != null ? ` — you lost ${Math.round(S.fatigueDrop * 100)}% of your reps first to last` : ''}. That is a recovery problem, not a strength problem.`,
        `Keep ${bw ? 'the same target' : `${fmt(w)}${u}`} and rest 30–60 seconds longer between sets. Hold set one at ${S.topSetReps}+ and the back sets will catch up.`,
      ],
      { target: { weight: w, reps: S.topSetReps + 1 }, confidence: 'high', flags: ['fatigue-normal'] },
    )
  }

  if (trend && trend.direction !== 'falling' && S.sessionsSinceBest <= 1) {
    return make(
      'REPEAT',
      `Below range but still trending up`,
      [
        lastLine,
        `Reps are under your ${spec.repMin} floor, but estimated 1RM is ${trend.direction === 'rising' ? `climbing ${trend.pctPerSession.toFixed(1)}% a session` : 'holding'} and your best session was ${S.sessionsSinceBest === 0 ? 'this one' : 'last one'}. Nothing here says drop the weight.`,
        `Run ${bw ? 'it' : `${fmt(w)}${u}`} again and get the top set to ${spec.repMin}.`,
      ],
      { target: { weight: w, reps: spec.repMin }, confidence: 'medium' },
    )
  }

  if (S.sessionsBelowFloor >= 3 && !bw) {
    const down = roundToStep(w - spec.step, spec.step)
    return make(
      'DROP',
      `${S.sessionsBelowFloor} sessions short — reset to ${fmt(down)}${u}`,
      [
        lastLine,
        `Your top set has missed ${spec.repMin} reps ${S.sessionsBelowFloor} sessions running at ${fmt(w)}${u}. This isn't fatigue anymore — the load is genuinely too heavy right now.`,
        `Take ${fmt(down)}${u}, build to ${spec.repMax} clean reps, then come back. Losing ${fmt(spec.step)}${u} for two weeks beats grinding half-reps for two months.`,
      ],
      { nextWeight: down, target: { weight: down, reps: spec.repMax }, flags: ['regression'] },
    )
  }

  return make(
    'REPEAT',
    `Short of ${spec.repMin} — run it back`,
    [
      lastLine,
      `Top set ${S.topSetReps}, average ${S.avgWorkReps.toFixed(1)}, both under your ${spec.repMin} floor. ${S.sessionsBelowFloor <= 1 ? 'One session under is noise — sleep, food, or the lift before this one.' : `That's ${S.sessionsBelowFloor} in a row, so one more decides it.`}`,
      `Same ${bw ? 'target' : `${fmt(w)}${u}`} next session. Get set one to ${spec.repMin} and you're back on track.`,
    ],
    { target: { weight: w, reps: spec.repMin }, confidence: 'medium' },
  )
}

// ── projections ─────────────────────────────────────────────────────────────

/**
 * Sessions until the average rep count should reach the ceiling, from the
 * recent rate of rep gain at the current weight. null when it isn't climbing.
 */
export function projectSessionsToIncrease(sessions: SessionPerf[], spec: ProgressionSpec): number | null {
  const latest = sessions[sessions.length - 1]
  const atWeight = sessions.filter(s => s.workWeight === latest.workWeight)
  if (atWeight.length < 2) return null

  const first = atWeight[0]
  const gainPerSession = (latest.avgWorkReps - first.avgWorkReps) / (atWeight.length - 1)
  if (gainPerSession <= 0.05) return null

  const remaining = spec.repMax - latest.avgWorkReps
  if (remaining <= 0) return 0
  return Math.max(1, Math.ceil(remaining / gainPerSession))
}

// ── live in-session cue ─────────────────────────────────────────────────────

export interface SetCue {
  label: string
  targetReps: number | null
  targetWeight: number | null
  tone: 'ahead' | 'on-track' | 'push'
}

/**
 * What to aim for on the set you're about to do. Compares set N of today
 * against set N of the last session at the same weight, so the target moves
 * with you instead of being one fixed number for the whole workout.
 */
export function nextSetGuidance(
  todaySets: PerfSet[],
  history: SessionPerf[],
  spec: ProgressionSpec,
  rx: Prescription | null,
): SetCue | null {
  const setNo = todaySets.length + 1

  if (!todaySets.length) {
    if (!rx?.target) return null
    const { weight, reps } = rx.target
    return {
      label: spec.bodyweight ? `Set 1 · ${reps} reps` : `Set 1 · ${fmt(weight)}${spec.units} × ${reps}`,
      targetReps: reps,
      targetWeight: spec.bodyweight ? null : weight,
      tone: 'push',
    }
  }

  const currentWeight = todaySets[todaySets.length - 1].weight
  const ref = [...history].reverse().find(s => s.workWeight === currentWeight)
  const refReps = ref?.workReps[setNo - 1] ?? null

  if (refReps == null) {
    const floor = Math.max(spec.repMin, todaySets[todaySets.length - 1].reps - 1)
    return {
      label: `Set ${setNo} · ${floor}+ holds the line`,
      targetReps: floor,
      targetWeight: spec.bodyweight ? null : currentWeight,
      tone: 'on-track',
    }
  }

  const doneSoFar = todaySets.reduce((s, x) => s + x.reps, 0)
  const refSoFar = (ref?.workReps ?? []).slice(0, todaySets.length).reduce((s, r) => s + r, 0)
  const ahead = doneSoFar >= refSoFar

  return {
    label: ahead
      ? `Set ${setNo} · ${refReps} matches, ${refReps + 1} wins the day`
      : `Set ${setNo} · beat ${refReps} from ${ref!.dateKey.slice(5).replace('-', '/')}`,
    targetReps: refReps + 1,
    targetWeight: spec.bodyweight ? null : currentWeight,
    tone: ahead ? 'ahead' : 'push',
  }
}

// ── convenience ─────────────────────────────────────────────────────────────

/** Logs → prescription in one call. The UI entry point. */
export function prescribe(
  logs: GymLog[],
  ex: GymExercise,
  units = 'lbs',
  ctx: ProgressionContext = {},
): Prescription | null {
  const spec = specFromExercise(ex, units)
  return decideProgression(buildSessionHistory(logs, spec, ctx.now), spec, ctx)
}
