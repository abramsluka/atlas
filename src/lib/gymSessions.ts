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

  await db.from('gym_sessions').upsert(
    {
      user_id: userId,
      date_key: dateKey,
      started_at: dayTs[0],
      ended_at: dayTs[dayTs.length - 1],
    },
    { onConflict: 'user_id,date_key' },
  )
}
