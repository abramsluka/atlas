import type { createServiceClient } from '@/lib/supabase/server'
import type { OuraData } from './types'
import { plausibleWakeHour } from './energyModel'

// Median wake hour from the user's recent Oura history — the fallback the
// energy model uses on mornings where the ring hasn't synced yet, so the
// curve starts near when this user actually wakes instead of a hardcoded 7am.
// Median over mean: one 4am flight or skipped night shouldn't drag it around.
export async function getTypicalWakeHour(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  timezone: string,
): Promise<number | null> {
  const { data } = await db
    .from('wearable_data')
    .select('provider, data')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .order('date', { ascending: false })
    .limit(28) // ~2 weeks of Oura nights

  const hours: number[] = []
  for (const row of data ?? []) {
    const iso = (row.data as OuraData | null)?.sleep?.bedtime_end
    const h = plausibleWakeHour(iso, timezone)
    if (h != null) hours.push(h)
  }
  if (hours.length === 0) return null
  hours.sort((a, b) => a - b)
  return hours[Math.floor(hours.length / 2)]
}
