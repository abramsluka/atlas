import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { AUTH_CODE_TTL_MS, checkClientAndRedirect, mintAuthCode, sha256Hex } from '@/lib/oauth'

export const runtime = 'nodejs'

// Consent decision target (form POST from /oauth/authorize). Requires the
// Supabase session cookie and re-validates the client + redirect_uri — hidden
// form fields are never trusted. Approve mints a single-use PKCE-bound code.
export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form = await req.formData()
  const decision = String(form.get('decision') ?? '')
  const clientId = form.get('client_id')?.toString()
  const redirectUri = form.get('redirect_uri')?.toString()
  const codeChallenge = form.get('code_challenge')?.toString()
  const state = form.get('state')?.toString()

  const db = createServiceClient()
  const check = await checkClientAndRedirect(db, clientId, redirectUri)
  // Never redirect to an unvalidated URI — plain 400, matching the consent page.
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 400 })

  const target = new URL(redirectUri!)
  if (state != null) target.searchParams.set('state', state)

  if (decision !== 'approve') {
    target.searchParams.set('error', 'access_denied')
    return NextResponse.redirect(target, 303)
  }

  if (!codeChallenge || codeChallenge.length < 43 || codeChallenge.length > 128) {
    return NextResponse.json({ error: 'PKCE code_challenge is required' }, { status: 400 })
  }

  const code = mintAuthCode()
  const { error } = await db.from('mcp_auth_codes').insert({
    code_hash: sha256Hex(code),
    client_id: check.client.client_id,
    user_id: user.id,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    expires_at: new Date(Date.now() + AUTH_CODE_TTL_MS).toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  target.searchParams.set('code', code)
  return NextResponse.redirect(target, 303)
}
