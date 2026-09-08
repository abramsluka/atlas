import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { APP_URL } from '@/lib/appUrl'
import { syncFitbitToday, GOOGLE_TOKEN_URL } from '@/features/health/fitbitSync'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')
  const expectedState = req.cookies.get('fitbit_oauth_state')?.value
  const verifier = req.cookies.get('fitbit_oauth_verifier')?.value

  if (oauthError) return NextResponse.redirect(new URL(`/health?error=fitbit_${oauthError}`, req.url))
  if (!code) return NextResponse.redirect(new URL('/health?error=no_code', req.url))
  if (!state || !expectedState || state !== expectedState || !verifier) {
    return NextResponse.redirect(new URL('/health?error=bad_state', req.url))
  }

  // Google's token endpoint: client secret in the body (a "Web application"
  // client is confidential), plus the PKCE verifier from the connect step.
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${APP_URL}/api/health/fitbit/callback`,
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!,
      code_verifier: verifier,
    }),
  })
  if (!tokenRes.ok) {
    console.error('[fitbit] token exchange failed:', tokenRes.status, await tokenRes.text().catch(() => ''))
    return NextResponse.redirect(new URL('/health?error=token_exchange', req.url))
  }

  const tokens = await tokenRes.json()
  // No refresh token means Google considered this a re-grant it had already
  // issued one for and prompt=consent didn't take. Without it the connection
  // dies in an hour, so refuse now rather than look connected and go blank.
  if (!tokens.refresh_token) {
    console.error('[fitbit] token response had no refresh_token')
    return NextResponse.redirect(new URL('/health?error=fitbit_no_refresh_token', req.url))
  }
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3599) * 1000).toISOString()

  const db = createServiceClient()
  await db.from('wearable_tokens').upsert(
    {
      user_id: user.id,
      provider: 'fitbit',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,provider' }
  )
  // One main wearable: connecting Fitbit replaces whatever else was connected.
  // Their cached history stays in wearable_data; only the tokens go.
  await db.from('wearable_tokens').delete().eq('user_id', user.id).neq('provider', 'fitbit')

  // Initial backfill: 14 days, so the history chart is populated on landing
  // and readiness has an HRV/RHR baseline from day one.
  const tz = await getUserTimezone(user.id)
  await syncFitbitToday(db, user.id, toLocalDate(tz), tz, true, 14).catch((e) => {
    console.error('[fitbit] initial sync failed:', e)
    return null
  })

  const res = NextResponse.redirect(new URL('/health', req.url))
  res.cookies.set('fitbit_oauth_state', '', { path: '/', maxAge: 0 })
  res.cookies.set('fitbit_oauth_verifier', '', { path: '/', maxAge: 0 })
  return res
}
