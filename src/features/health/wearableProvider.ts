type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

export type WearableProvider = 'oura' | 'whoop'

// Which wearable is the user's MAIN one. The OAuth callbacks enforce a single
// wearable_tokens row per user (connecting one deletes the other), so this is
// just "which row exists". Consumers default to 'oura' when null so cached
// history still renders after a disconnect.
export async function getActiveWearableProvider(db: DbClient, userId: string): Promise<WearableProvider | null> {
  const { data } = await db.from('wearable_tokens').select('provider').eq('user_id', userId).limit(2)
  const rows = (data ?? []) as Array<{ provider: string }>
  // A legacy account could still hold both rows; prefer whoop (the newer
  // connect) so a fresh switch wins until the stale row is cleaned up.
  if (rows.some((r) => r.provider === 'whoop')) return 'whoop'
  if (rows.some((r) => r.provider === 'oura')) return 'oura'
  return null
}
