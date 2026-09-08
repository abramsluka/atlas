import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'

// Kick off Fitbit OAuth. redirect_uri must byte-match the entry in the Fitbit
// developer portal (prod: https://atlas-phi-plum.vercel.app/api/health/fitbit/callback),
// so it's built from the canonical APP_URL, never from request headers.
//
// Authorization Code + PKCE, which Fitbit recommends for every app type, plus
// the Server-app client secret at the token step. The PKCE verifier and the
// CSRF state are mirrored into httpOnly cookies and checked in the callback.
export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  // A missing portal registration should say so on /health, not 500.
  if (!process.env.FITBIT_CLIENT_ID || !process.env.FITBIT_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/health?error=fitbit_not_configured', req.url))
  }

  const state = randomBytes(16).toString('hex')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.FITBIT_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/health/fitbit/callback`,
    // Everything fitbitSync reads: sleep logs, HRV + resting HR, steps +
    // calories, skin temperature. profile is harmless and lets the token
    // response carry the Fitbit user id.
    scope: 'sleep heartrate activity temperature profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const res = NextResponse.redirect(`https://www.fitbit.com/oauth2/authorize?${params}`)
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
