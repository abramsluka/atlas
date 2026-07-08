import { createHash } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'

// Resolve the MCP caller from an Authorization header. Two token families:
//  'atlas_mcp_' → mcp_tokens where kind='access', token_hash=sha256(token),
//                 revoked_at is null, expires_at > now() (OAuth, Phase 3)
//  'atlas_'     → user_settings.sync_token (exact match, no expiry)
// This is the entire security boundary for /api/mcp — every tool query must
// scope by the user_id returned here.
export async function resolveMcpUser(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  if (!token) return null

  const db = createServiceClient()

  // Check the longer prefix first — 'atlas_' matches 'atlas_mcp_...' too.
  if (token.startsWith('atlas_mcp_')) {
    const hash = createHash('sha256').update(token).digest('hex')
    const { data } = await db
      .from('mcp_tokens')
      .select('user_id')
      .eq('kind', 'access')
      .eq('token_hash', hash)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    return (data?.user_id as string | undefined) ?? null
  }

  if (token.startsWith('atlas_')) {
    const { data } = await db
      .from('user_settings')
      .select('user_id')
      .eq('sync_token', token)
      .maybeSingle()
    return (data?.user_id as string | undefined) ?? null
  }

  return null
}
