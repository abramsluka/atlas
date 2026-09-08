type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

export type WearableProvider = 'oura' | 'whoop' | 'fitbit'

// Every provider that writes OuraData-shaped rows into wearable_data. Consumers
// that query "any wearable row for today" filter on this instead of hand-listing
// providers, so adding a fourth is one edit here.
export const WEARABLE_PROVIDERS: WearableProvider[] = ['oura', 'whoop', 'fitbit']

// How each device is named in the UI and in AI prompts. The recovery label is
// quoted back to the user by the model, so it has to be true: Fitbit's readiness
// is an Atlas estimate (the Web API exposes no readiness or sleep score), and
// the prompt says so rather than letting the model present it as a device reading.
export const WEARABLE_LABEL: Record<WearableProvider, { name: string; card: string; recovery: string }> = {
  oura:   { name: 'Oura',   card: 'Oura Ring', recovery: 'Oura readiness' },
  whoop:  { name: 'WHOOP',  card: 'WHOOP',     recovery: 'WHOOP recovery' },
  fitbit: { name: 'Fitbit', card: 'Fitbit',    recovery: 'Fitbit readiness (Atlas estimate)' },
}

// Pure resolution from token rows, shared by the pages that already have the
// rows in hand from their own Promise.all. The OAuth callbacks enforce a single
// wearable_tokens row per user (connecting one deletes the rest), so this is
// normally "which row exists"; a legacy account could still hold several, and
// the newest integration wins so a fresh switch takes effect until the stale
// row is cleaned up.
export function resolveWearableProvider(rows: Array<{ provider: string }> | null | undefined): WearableProvider | null {
  const set = new Set((rows ?? []).map((r) => r.provider))
  if (set.has('fitbit')) return 'fitbit'
  if (set.has('whoop')) return 'whoop'
  if (set.has('oura')) return 'oura'
  return null
}

// Which wearable is the user's MAIN one. Consumers default to 'oura' when null
// so cached history still renders after a disconnect.
export async function getActiveWearableProvider(db: DbClient, userId: string): Promise<WearableProvider | null> {
  const { data } = await db.from('wearable_tokens').select('provider').eq('user_id', userId).limit(3)
  return resolveWearableProvider(data as Array<{ provider: string }> | null)
}
