import { describe, it, expect } from 'vitest'
import { getLiveSession, liveSessionBlock } from './liveGymSession'
import { SESSION_IDLE_MS } from '@/features/gym/sessionSignal'

// Minimal stand-in for the Supabase query builder: every chained method returns
// the same object, and awaiting it yields that table's canned result.
function fakeDb(tables: Record<string, { data: unknown; error?: unknown }>) {
  const from = (table: string) => {
    const result = tables[table] ?? { data: [] }
    const chain: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve)
          }
          return () => chain
        },
      },
    )
    return chain
  }
  return { from } as never
}

const NOW = new Date('2026-08-09T20:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

const set = (minutesAgo: number, name: string, weight: number, reps: number) => ({
  logged_at: ago(minutesAgo * MIN),
  weight,
  reps,
  gym_exercises: { name },
})

// Newest-first, matching the route's .order('logged_at', { ascending: false }).
const logs = (rows: ReturnType<typeof set>[]) => ({ data: rows })
const noSessions = { data: [] as Array<{ finished_at: string | null }> }

describe('getLiveSession', () => {
  it('returns null when nothing has been logged', async () => {
    const db = fakeDb({ gym_logs: { data: [] }, gym_sessions: noSessions })
    expect(await getLiveSession(db, 'u1', NOW)).toBeNull()
  })

  it('returns null once the workout has gone cold', async () => {
    // Last set is older than the idle window — auto-finished, not in progress.
    const db = fakeDb({
      gym_logs: logs([set(75, 'Bench Press', 135, 8)]),
      gym_sessions: noSessions,
    })
    expect(await getLiveSession(db, 'u1', NOW)).toBeNull()
  })

  it('reports a workout in progress with per-exercise totals', async () => {
    const db = fakeDb({
      gym_logs: logs([
        set(2, 'Lateral Raise', 25, 12),
        set(6, 'Lateral Raise', 20, 14),
        set(12, 'Incline Press', 70, 9),
        set(18, 'Incline Press', 65, 10),
      ]),
      gym_sessions: noSessions,
    })

    const live = await getLiveSession(db, 'u1', NOW)
    expect(live).not.toBeNull()
    expect(live!.setCount).toBe(4)
    expect(live!.minutesIn).toBe(18)
    expect(live!.minutesSinceLastSet).toBe(2)
    expect(live!.volume).toBe(25 * 12 + 20 * 14 + 70 * 9 + 65 * 10)
    expect(live!.lastSet).toEqual({ name: 'Lateral Raise', weight: 25, reps: 12 })
    // Oldest-first, so the list reads in the order he actually trained.
    expect(live!.exercises.map(e => e.name)).toEqual(['Incline Press', 'Lateral Raise'])
    // topWeight is the heaviest set of that exercise, not the most recent.
    expect(live!.exercises[0]).toMatchObject({ sets: 2, topWeight: 70, topReps: 9 })
  })

  it('returns null when Finish Workout was tapped after the last set', async () => {
    const db = fakeDb({
      gym_logs: logs([set(5, 'Bench Press', 135, 8)]),
      gym_sessions: { data: [{ finished_at: ago(1 * MIN) }] },
    })
    expect(await getLiveSession(db, 'u1', NOW)).toBeNull()
  })

  it('stays live when a set was logged after the finish mark (workout resumed)', async () => {
    const db = fakeDb({
      gym_logs: logs([set(2, 'Bench Press', 145, 6)]),
      gym_sessions: { data: [{ finished_at: ago(20 * MIN) }] },
    })
    expect(await getLiveSession(db, 'u1', NOW)).not.toBeNull()
  })

  it('ignores an earlier session separated by more than the idle window', async () => {
    const db = fakeDb({
      gym_logs: logs([
        set(5, 'Squat', 225, 5),
        set(10, 'Squat', 225, 5),
        // Morning session — a gap wider than the idle window, so not this workout.
        set(10 + SESSION_IDLE_MS / MIN + 30, 'Deadlift', 315, 3),
      ]),
      gym_sessions: noSessions,
    })

    const live = await getLiveSession(db, 'u1', NOW)
    expect(live!.setCount).toBe(2)
    expect(live!.exercises.map(e => e.name)).toEqual(['Squat'])
    expect(live!.minutesIn).toBe(10)
  })

  it('treats a query error as not-in-a-workout rather than throwing', async () => {
    const db = fakeDb({
      gym_logs: { data: null, error: { message: 'boom' } },
      gym_sessions: noSessions,
    })
    expect(await getLiveSession(db, 'u1', NOW)).toBeNull()
  })
})

describe('liveSessionBlock', () => {
  it('states plainly that he has not finished, with real numbers', async () => {
    const db = fakeDb({
      gym_logs: logs([set(3, 'Cable Row', 130, 10), set(9, 'Cable Row', 120, 12)]),
      gym_sessions: noSessions,
    })
    const block = liveSessionBlock((await getLiveSession(db, 'u1', NOW))!)

    expect(block).toContain('WORKOUT IN PROGRESS RIGHT NOW')
    expect(block).toContain('He has NOT finished')
    expect(block).toContain('2 sets logged')
    expect(block).toContain('Cable Row 2 sets (top 130×10)')
    expect(block).toContain('Last set: Cable Row 130×10')
  })
})
