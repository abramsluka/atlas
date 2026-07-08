import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { CORS_HEADERS, isAllowedRedirectUri, oauthError } from '@/lib/oauth'

export const runtime = 'nodejs'

// RFC 7591 dynamic client registration. Public clients only (PKCE, no secret);
// redirect URIs are validated against the same allowlist the authorize and
// token endpoints enforce, so nothing unregistrable ever gets stored.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be JSON')
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (redirectUris.length === 0) {
    return oauthError('invalid_redirect_uri', 'redirect_uris is required')
  }
  for (const uri of redirectUris) {
    if (!isAllowedRedirectUri(uri)) {
      return oauthError('invalid_redirect_uri', `redirect_uri not allowed: ${uri}`)
    }
  }

  const clientName =
    typeof body.client_name === 'string' && body.client_name.trim()
      ? body.client_name.trim().slice(0, 120)
      : null

  const db = createServiceClient()
  const { data, error } = await db
    .from('mcp_clients')
    .insert({ client_name: clientName, redirect_uris: redirectUris })
    .select('client_id')
    .single()
  if (error) return oauthError('server_error', error.message, 500)

  return Response.json(
    {
      client_id: data.client_id,
      client_name: clientName,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: 'none',
    },
    { status: 201, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
  )
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
