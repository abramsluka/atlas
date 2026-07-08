import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  ACCESS_TTL_SECONDS,
  CORS_HEADERS,
  OAUTH_SCOPE,
  issueTokenPair,
  oauthError,
  pkceMatches,
  sha256Hex,
} from '@/lib/oauth'

export const runtime = 'nodejs'

function tokenResponse(access: string, refresh: string): Response {
  return Response.json(
    {
      access_token: access,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh,
      scope: OAUTH_SCOPE,
    },
    { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}

// RFC 6749 token endpoint (form-encoded, public clients — no client secret).
// authorization_code + PKCE S256, and refresh_token with rotation. Single-use
// enforcement is atomic: the conditional UPDATE claims the code/refresh row,
// so a raced duplicate exchange loses and gets invalid_grant.
export async function POST(req: NextRequest) {
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return oauthError('invalid_request', 'Body must be application/x-www-form-urlencoded')
  }
  const grantType = form.get('grant_type')?.toString()
  const db = createServiceClient()

  if (grantType === 'authorization_code') {
    const code = form.get('code')?.toString()
    const redirectUri = form.get('redirect_uri')?.toString()
    const codeVerifier = form.get('code_verifier')?.toString()
    const clientId = form.get('client_id')?.toString()
    if (!code || !redirectUri || !codeVerifier) {
      return oauthError('invalid_request', 'code, redirect_uri and code_verifier are required')
    }

    const { data: row } = await db
      .from('mcp_auth_codes')
      .select('code_hash, client_id, user_id, redirect_uri, code_challenge, expires_at, used_at')
      .eq('code_hash', sha256Hex(code))
      .maybeSingle()

    if (
      !row ||
      row.used_at != null ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      (clientId && clientId !== row.client_id) ||
      redirectUri !== row.redirect_uri ||
      !pkceMatches(codeVerifier, row.code_challenge)
    ) {
      return oauthError('invalid_grant', 'Authorization code is invalid, expired or already used')
    }

    const { data: claimed } = await db
      .from('mcp_auth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code_hash', row.code_hash)
      .is('used_at', null)
      .select('code_hash')
    if (!claimed?.length) {
      return oauthError('invalid_grant', 'Authorization code is invalid, expired or already used')
    }

    const { access, refresh } = await issueTokenPair(db, row.user_id, row.client_id)
    return tokenResponse(access, refresh)
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token')?.toString()
    const clientId = form.get('client_id')?.toString()
    if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required')

    const { data: row } = await db
      .from('mcp_tokens')
      .select('id, user_id, client_id, expires_at, revoked_at')
      .eq('token_hash', sha256Hex(refreshToken))
      .eq('kind', 'refresh')
      .maybeSingle()

    if (
      !row ||
      row.revoked_at != null ||
      new Date(row.expires_at).getTime() <= Date.now() ||
      (clientId && row.client_id && clientId !== row.client_id)
    ) {
      return oauthError('invalid_grant', 'Refresh token is invalid, expired or revoked')
    }

    // Rotate: revoke the old refresh token, then issue a fresh pair.
    const { data: claimed } = await db
      .from('mcp_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('revoked_at', null)
      .select('id')
    if (!claimed?.length) {
      return oauthError('invalid_grant', 'Refresh token is invalid, expired or revoked')
    }

    const { access, refresh } = await issueTokenPair(db, row.user_id, row.client_id)
    return tokenResponse(access, refresh)
  }

  return oauthError('unsupported_grant_type', 'Use authorization_code or refresh_token')
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
