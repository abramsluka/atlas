import { createServiceClient } from '@/lib/supabase/server'

// Resolve a user from the long-lived sync token the Shortcut sends. Accepts
// `Authorization: Bearer <token>` (preferred) or a `?token=` query param
// (some Shortcut setups are easier with a query string).
export async function userIdFromSyncToken(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization') || ''
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  const token = bearer || new URL(req.url).searchParams.get('token')?.trim()
  if (!token) return null

  const db = createServiceClient()
  const { data } = await db
    .from('user_settings')
    .select('user_id')
    .eq('sync_token', token)
    .maybeSingle()

  return (data?.user_id as string | undefined) ?? null
}
