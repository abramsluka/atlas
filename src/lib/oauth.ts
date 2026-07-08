import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { APP_URL } from '@/lib/appUrl'

// OAuth 2.1 authorization-server core for the MCP connector: PKCE-only public
// clients, exact-match redirect allowlist (+ port-agnostic loopback), hashed
// tokens in mcp_tokens. resolveMcpUser (src/lib/mcpAuth.ts) consumes the
// access tokens minted here.

export const OAUTH_SCOPE = 'atlas:full'
export const ACCESS_TTL_SECONDS = 3600
export const REFRESH_TTL_SECONDS = 90 * 24 * 3600
export const AUTH_CODE_TTL_MS = 10 * 60 * 1000

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-protocol-version',
}

export const sha256Hex = (s: string) => createHash('sha256').update(s).digest('hex')

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── redirect URI rules ──────────────────────────────────────────────────────

const EXACT_ALLOWED_REDIRECTS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
]

// Claude Code's OAuth flow listens on a random localhost port.
function isLoopback(u: URL): boolean {
  return (
    u.protocol === 'http:' &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
    u.pathname === '/callback'
  )
}

// Registration-time rule: exact allowlist, or a loopback /callback. No other
// http(s) URIs are registrable.
export function isAllowedRedirectUri(uri: string): boolean {
  if (EXACT_ALLOWED_REDIRECTS.includes(uri)) return true
  try {
    return isLoopback(new URL(uri))
  } catch {
    return false
  }
}

// Authorize-time rule: the submitted redirect_uri must exactly match one the
// client registered, except loopback URIs compare scheme+host+path and ignore
// the port.
export function redirectUriMatches(submitted: string, registered: string[]): boolean {
  if (registered.includes(submitted)) return true
  try {
    const s = new URL(submitted)
    if (!isLoopback(s)) return false
    return registered.some((r) => {
      try {
        const u = new URL(r)
        return isLoopback(u) && u.hostname === s.hostname
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

// ─── PKCE (S256 only) ────────────────────────────────────────────────────────

export function pkceMatches(codeVerifier: string, codeChallenge: string): boolean {
  return createHash('sha256').update(codeVerifier).digest('base64url') === codeChallenge
}

// ─── tokens ──────────────────────────────────────────────────────────────────

export function mintAuthCode(): string {
  return randomBytes(32).toString('hex')
}

export async function issueTokenPair(
  db: SupabaseClient,
  userId: string,
  clientId: string | null
): Promise<{ access: string; refresh: string }> {
  const access = 'atlas_mcp_' + randomBytes(24).toString('hex')
  const refresh = 'atlas_ref_' + randomBytes(24).toString('hex')
  const now = Date.now()
  const { error } = await db.from('mcp_tokens').insert([
    {
      user_id: userId,
      client_id: clientId,
      kind: 'access',
      token_hash: sha256Hex(access),
      expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
    },
    {
      user_id: userId,
      client_id: clientId,
      kind: 'refresh',
      token_hash: sha256Hex(refresh),
      expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString(),
    },
  ])
  if (error) throw new Error(error.message)
  return { access, refresh }
}

// ─── authorize-request validation (shared by consent page + decision POST) ───

export interface McpClientRow {
  client_id: string
  client_name: string | null
  redirect_uris: string[]
}

export type AuthorizeCheck = { ok: true; client: McpClientRow } | { ok: false; reason: string }

// Never redirect on failure here — an invalid client or redirect_uri must render
// an error, not bounce the browser to an attacker-chosen URL.
export async function checkClientAndRedirect(
  db: SupabaseClient,
  clientId: string | undefined,
  redirectUri: string | undefined
): Promise<AuthorizeCheck> {
  if (!clientId || !UUID_RE.test(clientId)) return { ok: false, reason: 'Unknown client_id.' }
  if (!redirectUri) return { ok: false, reason: 'Missing redirect_uri.' }

  const { data } = await db
    .from('mcp_clients')
    .select('client_id, client_name, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!data) return { ok: false, reason: 'Unknown client_id.' }

  const registered = Array.isArray(data.redirect_uris) ? data.redirect_uris.map(String) : []
  if (!redirectUriMatches(redirectUri, registered)) {
    return { ok: false, reason: 'redirect_uri is not registered for this client.' }
  }
  return { ok: true, client: { ...data, redirect_uris: registered } }
}

// ─── RFC 6749 / 7591 error responses ─────────────────────────────────────────

export function oauthError(error: string, description: string, status = 400): Response {
  return Response.json(
    { error, error_description: description },
    { status, headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } }
  )
}

// ─── discovery metadata ──────────────────────────────────────────────────────

export function protectedResourceMetadata() {
  return {
    resource: `${APP_URL}/api/mcp`,
    authorization_servers: [APP_URL],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
  }
}

export function authorizationServerMetadata() {
  return {
    issuer: APP_URL,
    authorization_endpoint: `${APP_URL}/oauth/authorize`,
    token_endpoint: `${APP_URL}/api/oauth/token`,
    registration_endpoint: `${APP_URL}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [OAUTH_SCOPE],
  }
}
