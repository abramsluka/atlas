import type { createServiceClient } from '@/lib/supabase/server'
import type { OuraData } from './types'
import { plausibleWakeHour } from './energyModel'
import { getActiveWearableProvider } from './wearableProvider'
import { getUserSchedule } from '@/lib/getUserSchedule'

// The energy model's fallback wake hour for mornings where the wearable hasn't
// synced (a measured wake from last night still wins in deriveWake). The wake
// time the user set in Settings takes precedence; otherwise the median wake
// from the ACTIVE provider's recent history (this was hard-coded to Oura,
// which made it come back empty for anyone on WHOOP). Null → the model's 7am.
// Median over mean: one 4am flight or skipped night shouldn't drag it around.
export async function getTypicalWakeHour(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
  timezone: string,
): Promise<number | null> {
  const [manual, provider] = await Promise.all([
    getUserSchedule(db, userId),
    getActiveWearableProvider(db, userId),
  ])
  if (manual.wakeHour != null) return manual.wakeHour

  const { data } = await db
    .from('wearable_data')
    .select('provider, data')
    .eq('user_id', userId)
    .eq('provider', provider ?? 'oura')
    .order('date', { ascending: false })
    .limit(28) // ~2 weeks of nights

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
