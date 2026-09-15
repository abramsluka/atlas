import type { createServiceClient } from '@/lib/supabase/server'
import { scheduleHours, type ScheduleHours } from '@/lib/schedule'

// The user's wake/sleep times from Settings, as hours. Both null when unset —
// callers keep their own defaults so an untouched account behaves as before.
export async function getUserSchedule(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<ScheduleHours> {
  const { data } = await db
    .from('user_settings')
    .select('wake_time, sleep_time')
    .eq('user_id', userId)
    .maybeSingle()
  return scheduleHours(data?.wake_time ?? null, data?.sleep_time ?? null)
}
