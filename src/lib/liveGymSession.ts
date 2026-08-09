import type { createServiceClient } from '@/lib/supabase/server'
import { SESSION_IDLE_MS } from '@/features/gym/sessionSignal'
import { laDateKey } from '@/lib/gymSessions'

// Server-side answer to "is he lifting RIGHT NOW?".
//
// The Gym page's set timer lives in localStorage, so it can only ever tell the
// one device it runs on. This derives the same fact from gym_logs + the
// gym_sessions finish marker, which every API route can read. Two things end a
// session: tapping Finish Workout (finished_at), or the workout going cold
// (SESSION_IDLE_MS with no set logged). Everything else is mid-workout.

type DB = ReturnType<typeof createServiceClient>

// How far back a single session could reasonably start. A session can't contain
// a gap longer than SESSION_IDLE_MS, so this only bounds the query.
const LOOKBACK_MS = 12 * 3600_000

interface LogRow {
  logged_at: string
  weight: number | null
  reps: number | null
  gym_exercises: { name: string } | null
}

export interface LiveSessionExercise {
  name: string
  sets: number
  topWeight: number | null
  topReps: number | null
}

export interface LiveSession {
  startedAt: string           // first set of this contiguous block
  lastSetAt: string           // most recent set
  minutesIn: number           // since the first set
  minutesSinceLastSet: number // how long he's been resting
  setCount: number
  volume: number              // sum of weight × reps
  exercises: LiveSessionExercise[]
  lastSet: { name: string; weight: number | null; reps: number | null }
}

/**
 * The workout in progress right now, or null when he isn't training.
 *
 * Returns null when: no sets in the lookback window, the last set is older than
 * SESSION_IDLE_MS (the workout went cold and auto-finished), or Finish Workout
 * was tapped after the last set.
 */
export async function getLiveSession(db: DB, userId: string, now = Date.now()): Promise<LiveSession | null> {
  const { data, error } = await db
    .from('gym_logs')
    .select('logged_at, weight, reps, gym_exercises(name)')
    .eq('user_id', userId)
    .gte('logged_at', new Date(now - LOOKBACK_MS).toISOString())
    .order('logged_at', { ascending: false })
    .limit(200)
  if (error) return null

  const rows = (data ?? []) as unknown as LogRow[]
  if (rows.length === 0) return null

  const lastSetAt = rows[0].logged_at
  const sinceLast = now - new Date(lastSetAt).getTime()
  if (sinceLast > SESSION_IDLE_MS) return null // cold — the workout is over

  // Walk back while consecutive sets stay within the idle window, so a morning
  // session doesn't get glued onto an evening one on the same day.
  const block: LogRow[] = [rows[0]]
  for (let i = 1; i < rows.length; i++) {
    const gap = new Date(block[block.length - 1].logged_at).getTime() - new Date(rows[i].logged_at).getTime()
    if (gap > SESSION_IDLE_MS) break
    block.push(rows[i])
  }

  // Explicitly finished? Check every day the block touches, since a workout can
  // straddle midnight and gym_sessions is keyed per calendar day.
  const dayKeys = [...new Set(block.map(l => laDateKey(l.logged_at)))]
  const { data: sessions } = await db
    .from('gym_sessions')
    .select('finished_at')
    .eq('user_id', userId)
    .in('date_key', dayKeys)
  const lastSetMs = new Date(lastSetAt).getTime()
  const finished = (sessions ?? []).some(
    (s: { finished_at: string | null }) => s.finished_at && new Date(s.finished_at).getTime() >= lastSetMs,
  )
  if (finished) return null

  // Oldest-first for a readable "what he's done so far" list.
  const ordered = [...block].reverse()
  const startedAt = ordered[0].logged_at

  const byName = new Map<string, LiveSessionExercise>()
  let volume = 0
  for (const log of ordered) {
    const name = log.gym_exercises?.name ?? 'Unknown'
    volume += (log.weight ?? 0) * (log.reps ?? 0)
    const ex = byName.get(name)
    if (!ex) {
      byName.set(name, { name, sets: 1, topWeight: log.weight, topReps: log.reps })
    } else {
      ex.sets++
      if ((log.weight ?? 0) > (ex.topWeight ?? 0)) {
        ex.topWeight = log.weight
        ex.topReps = log.reps
      }
    }
  }

  const newest = block[0]
  return {
    startedAt,
    lastSetAt,
    minutesIn: Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 60_000)),
    minutesSinceLastSet: Math.max(0, Math.round(sinceLast / 60_000)),
    setCount: block.length,
    volume: Math.round(volume),
    exercises: [...byName.values()],
    lastSet: { name: newest.gym_exercises?.name ?? 'Unknown', weight: newest.weight, reps: newest.reps },
  }
}

/**
 * Prompt block describing the workout in progress. Every AI surface that can
 * catch Luka mid-set feeds this in so it stops telling him to go train.
 */
export function liveSessionBlock(s: LiveSession): string {
  const setLabel = (w: number | null, r: number | null) =>
    w != null && r != null ? `${w}×${r}` : r != null ? `${r} reps` : '—'
  const done = s.exercises
    .map(e => `${e.name} ${e.sets} set${e.sets === 1 ? '' : 's'} (top ${setLabel(e.topWeight, e.topReps)})`)
    .join(', ')

  return [
    'WORKOUT IN PROGRESS RIGHT NOW — he is mid-session, between sets, phone in hand. He has NOT finished.',
    `  ${s.minutesIn} min into the session · last set ${s.minutesSinceLastSet === 0 ? 'just now' : `${s.minutesSinceLastSet} min ago`} · ${s.setCount} sets logged · ${s.volume.toLocaleString()} lbs moved`,
    `  Done so far: ${done}`,
    `  Last set: ${s.lastSet.name} ${setLabel(s.lastSet.weight, s.lastSet.reps)}`,
  ].join('\n')
}
