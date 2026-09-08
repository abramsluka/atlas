import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'
import { GOOGLE_HEALTH_SCOPES } from '@/features/health/fitbitSync'

// Kick off Fitbit OAuth — which is GOOGLE OAuth, because the Google Health API
// replaced the legacy Fitbit Web API (sunset 2026-09-30). redirect_uri must
// byte-match an Authorized redirect URI on the OAuth client in Google Cloud
// (prod: https://atlas-phi-plum.vercel.app/api/health/fitbit/callback), so it's
// built from the canonical APP_URL, never from request headers.
//
// access_type=offline + prompt=consent is what makes Google return a refresh
// token (it only does so on a consenting grant, and only when asked). PKCE
// verifier and CSRF state are mirrored into httpOnly cookies for the callback.
export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  // A missing Cloud registration should say so on /health, not 500.
  if (!process.env.GOOGLE_HEALTH_CLIENT_ID || !process.env.GOOGLE_HEALTH_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/health?error=fitbit_not_configured', req.url))
  }

  const state = randomBytes(16).toString('hex')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/health/fitbit/callback`,
    scope: GOOGLE_HEALTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  }
  res.cookies.set('fitbit_oauth_state', state, cookie)
  res.cookies.set('fitbit_oauth_verifier', verifier, cookie)
  return res
}
