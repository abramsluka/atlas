import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'

// Kick off WHOOP OAuth. redirect_uri must byte-match the WHOOP portal entry
// (prod: https://atlas-phi-plum.vercel.app/api/health/whoop/callback), so it's
// built from the canonical APP_URL, never from request headers. WHOOP REQUIRES
// a `state` param (min 8 chars); it's mirrored into an httpOnly cookie and
// verified in the callback. `offline` is what grants a refresh token.
export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const state = randomBytes(16).toString('hex')
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: `${APP_URL}/api/health/whoop/callback`,
    scope: 'offline read:recovery read:sleep read:cycles',
    state,
  })

  const res = NextResponse.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`)
  res.cookies.set('whoop_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return res
}
