import { describe, it, expect } from 'vitest'
import type { GymExercise, GymLog } from './types'
import {
  buildSessionHistory,
  decideProgression,
  nextSetGuidance,
  prescribe,
  repZone,
  specFromExercise,
  type ProgressionSpec,
} from './progression'

// ── fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-09T20:00:00Z')

function keyDaysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86400000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

type Day = { daysAgo: number; sets: [weight: number, reps: number][]; swapped?: string }

let seq = 0
function logsFor(days: Day[]): GymLog[] {
  return days.flatMap(d =>
    d.sets.map(([weight, reps], i) => ({
      id: `l${seq++}`,
      exercise_id: 'ex',
      weight,
      reps,
      logged_at: `${keyDaysAgo(d.daysAgo)}T${String(18 + i).padStart(2, '0')}:00:00Z`,
      performed_exercise: d.swapped ?? null,
    })),
  )
}

function exercise(over: Partial<GymExercise> = {}): GymExercise {
  return {
    id: 'ex',
    name: 'Bench Press',
    gym_ids: [],
    day_ids: [],
    bodyweight: false,
    start_weight: 45,
    rep_min: 8,
    rep_max: 12,
    step: 5,
    order_index: 0,
    ...over,
  }
}

function rx(days: Day[], ex = exercise(), readiness?: number) {
  return prescribe(logsFor(days), ex, 'lbs', { now: NOW, readiness })
}

// ── the two failures that motivated the rewrite ─────────────────────────────

describe('the last set is not the session', () => {
  // "I just did preacher curls for 120, 9 reps and 8 reps, then on the last set
  // I do 7. That doesn't mean go down. It means keep pushing."
  it('reads 120 x 9,8,7 as a good session, not a reason to drop', () => {
    const p = rx(
      [
        { daysAgo: 7, sets: [[120, 8], [120, 7], [120, 7]] },
        { daysAgo: 0, sets: [[120, 9], [120, 8], [120, 7]] },
      ],
      exercise({ name: 'Preacher Curl', rep_min: 8, rep_max: 12, step: 5 }),
    )!

    expect(p.action).toBe('HOLD')
    expect(p.nextWeight).toBeUndefined()
    expect(p.headline).toMatch(/pushing/i)
    expect(p.signals.topSetReps).toBe(9)
    expect(p.signals.avgWorkReps).toBeCloseTo(8, 5)
    expect(p.trend!.direction).toBe('rising')
  })

  // The same shape but the whole session sags below the floor: top set still
  // clears rep_min, so it's a recovery problem, not a strength problem.
  it('holds when only the back-off sets fell out of range', () => {
    const p = rx([
      { daysAgo: 14, sets: [[135, 9], [135, 8], [135, 8]] },
      { daysAgo: 7, sets: [[135, 9], [135, 8], [135, 8]] },
      { daysAgo: 0, sets: [[135, 9], [135, 6], [135, 5]] },
    ])!

    expect(p.action).toBe('HOLD')
    expect(p.headline).toMatch(/top set was in range/i)
    expect(p.detail.join(' ')).toMatch(/recovery problem, not a strength problem/i)
  })
})

describe('reps alone cannot answer the question', () => {
  // 115x12 then 145x7. Averaging reps gives 9.5 -> "hold", and the weight
  // column never gets read. e1RM went 161 -> 179, an 11% gain.
  it('treats 115x12 -> 145x7 as progress, not a collapse', () => {
    const p = rx([
      { daysAgo: 30, sets: [[115, 12], [115, 11], [115, 10]] },
      { daysAgo: 0, sets: [[145, 7], [145, 6], [145, 6]] },
    ])!

    expect(p.action).toBe('REPEAT')
    expect(p.action).not.toBe('DROP')
    expect(p.signals.perfVsPrevPct).toBeGreaterThan(10)
    expect(p.detail.join(' ')).toMatch(/estimated 1RM is up/i)
  })

  // Epley says 175x3 (192 e1RM) beats 135x12 (189), so an e1RM check alone
  // waves this through. It's still the wrong prescription: an 8-12 rep slot
  // just became a triple. The reps say overshot; the e1RM says where to land.
  it('lands the bar where the rep floor lives when a jump overshoots', () => {
    const p = rx([
      { daysAgo: 14, sets: [[135, 11], [135, 10], [135, 10]] },
      { daysAgo: 7, sets: [[135, 12], [135, 11], [135, 10]] },
      { daysAgo: 0, sets: [[175, 3], [175, 2], [175, 2]] },
    ])!

    expect(p.action).toBe('DROP')
    expect(p.nextWeight).toBe(150) // 192 e1RM / (1 + 8/30) ≈ 152, on the step grid
    expect(p.flags).toContain('jump-too-big')
  })
})

// ── rep zones tile the number line ──────────────────────────────────────────

describe('rep zones', () => {
  const spec: ProgressionSpec = { repMin: 8, repMax: 12, step: 5, bodyweight: false, units: 'lbs' }

  it('assigns exactly one zone to every value, including both boundaries', () => {
    expect(repZone(7.99, spec)).toBe('below')
    expect(repZone(8, spec)).toBe('in')       // the gap in "x < 8 / 8 < x < 13"
    expect(repZone(11.99, spec)).toBe('in')
    expect(repZone(12, spec)).toBe('ceiling') // the overlap in "8 < x < 13 / x > 12"
    expect(repZone(20, spec)).toBe('ceiling')
  })

  it('never returns undefined across the whole range', () => {
    for (let r = 0; r <= 30; r += 0.25) {
      expect(['below', 'in', 'ceiling']).toContain(repZone(r, spec))
    }
  })
})

// ── the earned increase ─────────────────────────────────────────────────────

describe('increasing', () => {
  it('adds one step when the average clears the ceiling', () => {
    const p = rx([
      { daysAgo: 14, sets: [[135, 10], [135, 10], [135, 9]] },
      { daysAgo: 7, sets: [[135, 11], [135, 11], [135, 10]] },
      { daysAgo: 0, sets: [[135, 12], [135, 12], [135, 12]] },
    ])!

    expect(p.action).toBe('INCREASE')
    expect(p.nextWeight).toBe(140)
    expect(p.target).toEqual({ weight: 140, reps: 8 })
  })

  it('takes a double jump when every set buried the ceiling', () => {
    const p = rx([
      { daysAgo: 7, sets: [[135, 13], [135, 13], [135, 12]] },
      { daysAgo: 0, sets: [[135, 15], [135, 14], [135, 13]] },
    ])!

    expect(p.action).toBe('INCREASE')
    expect(p.nextWeight).toBe(145)
    expect(p.detail.join(' ')).toMatch(/double jump/i)
  })

  it('banks the jump for a rested day when readiness is low', () => {
    const p = rx(
      [
        { daysAgo: 7, sets: [[135, 11], [135, 11], [135, 10]] },
        { daysAgo: 0, sets: [[135, 12], [135, 12], [135, 12]] },
      ],
      exercise(),
      48,
    )!

    expect(p.action).toBe('HOLD')
    expect(p.flags).toContain('readiness-low')
    expect(p.detail.join(' ')).toMatch(/readiness is 48/i)
  })
})

// ── the yo-yo the old engine created ────────────────────────────────────────

describe('grace after a weight increase', () => {
  it('does not drop back the session after a jump just because reps fell', () => {
    const p = rx([
      { daysAgo: 14, sets: [[135, 11], [135, 11], [135, 10]] },
      { daysAgo: 7, sets: [[135, 12], [135, 12], [135, 12]] },
      { daysAgo: 0, sets: [[140, 7], [140, 6], [140, 6]] },
    ])!

    expect(p.action).toBe('REPEAT')
    expect(p.flags).toContain('new-weight')
    expect(p.target).toEqual({ weight: 140, reps: 8 })
  })
})

// ── stalls, regressions, and the difference between them ────────────────────

describe('stalling and regressing', () => {
  it('deloads only after a month of the same weight going nowhere', () => {
    const p = rx([
      { daysAgo: 28, sets: [[135, 8], [135, 7], [135, 7]] },
      { daysAgo: 21, sets: [[135, 7], [135, 6], [135, 6]] },
      { daysAgo: 14, sets: [[135, 7], [135, 6], [135, 5]] },
      { daysAgo: 7, sets: [[135, 6], [135, 6], [135, 5]] },
      { daysAgo: 0, sets: [[135, 7], [135, 5], [135, 5]] },
    ])!

    expect(p.action).toBe('DELOAD')
    expect(p.nextWeight).toBe(120) // 135 * 0.9 = 121.5, rounded to a 5 lb step
    expect(p.flags).toContain('stalled')
  })

  it('does not deload on three tired sets at one weight', () => {
    // The old rule deloaded here: three consecutive sets at the same weight
    // with the last one under rep_min.
    const p = rx([{ daysAgo: 0, sets: [[135, 9], [135, 8], [135, 7]] }])!
    expect(p.action).not.toBe('DELOAD')
    expect(p.confidence).toBe('low')
  })

  it('drops after two consecutive sessions of falling output', () => {
    const p = rx([
      { daysAgo: 21, sets: [[135, 10], [135, 9], [135, 9]] },
      { daysAgo: 14, sets: [[135, 11], [135, 10], [135, 10]] },
      { daysAgo: 7, sets: [[135, 9], [135, 8], [135, 7]] },
      { daysAgo: 0, sets: [[135, 7], [135, 6], [135, 6]] },
    ])!

    expect(p.action).toBe('DROP')
    expect(p.nextWeight).toBe(130)
    expect(p.flags).toContain('regression')
  })

  it('runs it back after a single bad session instead of dropping', () => {
    const p = rx([
      { daysAgo: 21, sets: [[135, 10], [135, 9], [135, 9]] },
      { daysAgo: 14, sets: [[135, 11], [135, 10], [135, 9]] },
      { daysAgo: 7, sets: [[135, 11], [135, 10], [135, 10]] },
      { daysAgo: 0, sets: [[135, 7], [135, 7], [135, 6]] },
    ])!

    expect(p.action).toBe('REPEAT')
    expect(p.signals.sessionsBelowFloor).toBe(1)
    expect(p.detail.join(' ')).toMatch(/one session under is noise/i)
  })

  it('names a lever instead of just saying stuck', () => {
    const p = rx([
      { daysAgo: 21, sets: [[135, 9], [135, 9], [135, 8]] },
      { daysAgo: 14, sets: [[135, 9], [135, 8], [135, 8]] },
      { daysAgo: 7, sets: [[135, 9], [135, 9], [135, 8]] },
      { daysAgo: 0, sets: [[135, 9], [135, 8], [135, 8]] },
    ])!

    expect(p.action).toBe('HOLD')
    expect(p.headline).toMatch(/flat/i)
    expect(p.detail.join(' ')).toMatch(/rest 3 minutes|add a fourth set|slow the lowering/i)
  })
})

// ── time off ────────────────────────────────────────────────────────────────

describe('layoffs', () => {
  it('works back up after three weeks off instead of punishing the return', () => {
    const p = rx([
      { daysAgo: 60, sets: [[135, 10], [135, 9], [135, 9]] },
      { daysAgo: 30, sets: [[135, 6], [135, 5], [135, 5]] },
    ])!

    expect(p.action).toBe('REPEAT')
    expect(p.flags).toContain('layoff')
    expect(p.nextWeight).toBe(120) // 90% of 135, on the step grid
  })

  it('backs off further after a long layoff', () => {
    const p = rx([{ daysAgo: 90, sets: [[135, 10], [135, 9], [135, 9]] }])!
    expect(p.nextWeight).toBe(110) // 80% of 135, on the step grid
  })
})

// ── prep-stage correctness ──────────────────────────────────────────────────

describe('buildSessionHistory', () => {
  const spec = specFromExercise(exercise())

  it('picks the working weight by set count, not by what was heaviest', () => {
    const [s] = buildSessionHistory(
      logsFor([{ daysAgo: 0, sets: [[185, 1], [135, 10], [135, 9], [135, 9]] }]),
      spec,
      NOW,
    )
    expect(s.topWeight).toBe(185)
    expect(s.workWeight).toBe(135)
    expect(s.workReps).toEqual([10, 9, 9])
    expect(s.avgWorkReps).toBeCloseTo(9.33, 2)
  })

  it('excludes swapped sets so a substitute never drives this lift', () => {
    const history = buildSessionHistory(
      logsFor([
        { daysAgo: 7, sets: [[135, 10], [135, 9]] },
        { daysAgo: 0, sets: [[60, 12], [60, 12]], swapped: 'Dumbbell Press' },
      ]),
      spec,
      NOW,
    )
    expect(history).toHaveLength(1)
    expect(history[0].workWeight).toBe(135)
  })

  it('measures fatigue drop-off across the working sets', () => {
    const [s] = buildSessionHistory(logsFor([{ daysAgo: 0, sets: [[120, 9], [120, 8], [120, 6]] }]), spec, NOW)
    expect(s.fatigueDrop).toBeCloseTo(1 / 3, 3)
    expect(s.topSetReps).toBe(9)
    expect(s.lastWorkReps).toBe(6)
  })

  it('trends bodyweight lifts on reps, since the load never changes', () => {
    const bwSpec = specFromExercise(exercise({ bodyweight: true, rep_min: 8, rep_max: 15 }))
    const history = buildSessionHistory(
      logsFor([
        { daysAgo: 7, sets: [[0, 10], [0, 9]] },
        { daysAgo: 0, sets: [[0, 13], [0, 12]] },
      ]),
      bwSpec,
      NOW,
    )
    expect(history.map(s => s.perf)).toEqual([10, 13])
  })
})

// ── in-session cue ──────────────────────────────────────────────────────────

describe('nextSetGuidance', () => {
  const spec = specFromExercise(exercise())
  const history = buildSessionHistory(
    logsFor([{ daysAgo: 7, sets: [[135, 9], [135, 8], [135, 7]] }]),
    spec,
    NOW,
  )

  it('opens with the prescribed weight and rep target', () => {
    const p = decideProgression(history, spec)
    const cue = nextSetGuidance([], history, spec, p)!
    expect(cue.label).toMatch(/^Set 1 · 135lbs × \d+$/)
  })

  it('targets the matching set from the last session at this weight', () => {
    const cue = nextSetGuidance([{ weight: 135, reps: 9 }], history, spec, null)!
    expect(cue.label).toMatch(/Set 2 · \d+ matches/)
    expect(cue.tone).toBe('ahead')
  })

  it('tells you to beat the number when you are behind last session', () => {
    const cue = nextSetGuidance([{ weight: 135, reps: 7 }], history, spec, null)!
    expect(cue.label).toMatch(/Set 2 · beat 8/)
    expect(cue.tone).toBe('push')
  })

  it('falls back to a floor when the last session had fewer sets', () => {
    const done = [
      { weight: 135, reps: 9 },
      { weight: 135, reps: 8 },
      { weight: 135, reps: 8 },
    ]
    const cue = nextSetGuidance(done, history, spec, null)!
    expect(cue.label).toMatch(/Set 4 · \d+\+ holds the line/)
  })
})

// ── edges ───────────────────────────────────────────────────────────────────

describe('edges', () => {
  it('returns null with no history', () => {
    expect(prescribe([], exercise())).toBeNull()
  })

  it('never fires a high-confidence call off one session', () => {
    const p = rx([{ daysAgo: 0, sets: [[135, 10], [135, 9]] }])!
    expect(p.confidence).toBe('low')
    expect(p.flags).toContain('low-data')
  })

  it('never prescribes a negative or zero weight', () => {
    const p = rx(
      [
        { daysAgo: 21, sets: [[5, 4]] },
        { daysAgo: 14, sets: [[5, 3]] },
        { daysAgo: 7, sets: [[5, 3]] },
        { daysAgo: 0, sets: [[5, 2]] },
      ],
      exercise({ step: 5 }),
    )!
    expect(p.nextWeight ?? 5).toBeGreaterThan(0)
  })

  it('always returns a decision for any plausible session', () => {
    for (let reps = 1; reps <= 25; reps++) {
      for (const weight of [45, 95, 135, 225]) {
        const p = rx([
          { daysAgo: 7, sets: [[weight, reps], [weight, reps]] },
          { daysAgo: 0, sets: [[weight, reps], [weight, reps], [weight, reps]] },
        ])
        expect(p).not.toBeNull()
        expect(['INCREASE', 'HOLD', 'REPEAT', 'DROP', 'DELOAD']).toContain(p!.action)
        expect(p!.detail.length).toBeGreaterThan(0)
      }
    }
  })
})
