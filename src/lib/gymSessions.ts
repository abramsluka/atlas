import type { SupabaseClient } from '@supabase/supabase-js'

const LA_TZ = 'America/Los_Angeles'

/**
 * LA calendar day (YYYY-MM-DD) for an ISO timestamp. Matches the client's
 * logDatePST grouping so sessions line up with the Gym history exactly.
 */
export function laDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: LA_TZ })
}

/**
 * Re-derive the gym_sessions row for a user's LA training day from its set logs:
 * started_at = first set, ended_at = last set. Removes the session when the day
 * has no sets left. Idempotent — safe to call after every set insert/delete.
 *
 * finished_at is owned by the Finish Workout button, not by this function, with
 * one exception: a set logged AFTER the workout was marked finished means he
 * picked it back up, so the marker is cleared and the session goes live again.
 */
export async function syncGymSession(db: SupabaseClient, userId: string, dateKey: string) {
  // UTC window that safely brackets the LA day (DST-proof); filtered precisely below.
  const lo = new Date(dateKey + 'T00:00:00Z')
  lo.setUTCDate(lo.getUTCDate() - 1)
  const hi = new Date(dateKey + 'T00:00:00Z')
  hi.setUTCDate(hi.getUTCDate() + 2)

  const { data: logs } = await db
    .from('gym_logs')
    .select('logged_at')
    .eq('user_id', userId)
    .gte('logged_at', lo.toISOString())
    .lt('logged_at', hi.toISOString())

  const dayTs = (logs ?? [])
    .map((l) => l.logged_at as string)
    .filter((ts) => laDateKey(ts) === dateKey)
    .sort()

  if (dayTs.length === 0) {
    await db.from('gym_sessions').delete().eq('user_id', userId).eq('date_key', dateKey)
    return
  }

  const lastSetAt = dayTs[dayTs.length - 1]

  // Resumed-workout check: only reopen a session whose finish mark predates the
  // newest set. Columns left out of the payload keep their value on upsert, so
  // finished_at survives every other sync untouched.
  const { data: existing } = await db
    .from('gym_sessions')
    .select('finished_at')
    .eq('user_id', userId)
    .eq('date_key', dateKey)
    .maybeSingle()
  const resumed =
    !!existing?.finished_at && new Date(existing.finished_at).getTime() < new Date(lastSetAt).getTime()

  await db.from('gym_sessions').upsert(
    {
      user_id: userId,
      date_key: dateKey,
      started_at: dayTs[0],
      ended_at: lastSetAt,
      ...(resumed ? { finished_at: null } : {}),
    },
    { onConflict: 'user_id,date_key' },
  )
}
