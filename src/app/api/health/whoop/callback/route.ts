import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const code = req.nextUrl.searchParams.get('code')
  const returnedState = req.nextUrl.searchParams.get('state')
  const savedState = req.cookies.get('whoop_state')?.value
  const whoopError = req.nextUrl.searchParams.get('error')

  if (!code) {
    console.error('Whoop callback missing code. error:', whoopError, 'params:', req.nextUrl.search)
    return NextResponse.redirect(new URL(`/health?error=no_code&why=${whoopError ?? 'unknown'}`, req.url))
  }

  if (!savedState || returnedState !== savedState) {
    console.error('Whoop state mismatch', { returnedState, savedState })
    return NextResponse.redirect(new URL('/health?error=state_mismatch', req.url))
  }

  const tokenRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: 'https://atlas-phi-plum.vercel.app/api/health/whoop/callback',
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/health?error=token_exchange', req.url))
  }

  const tokens = await tokenRes.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()

  const db = createServiceClient()
  const { error: upsertError } = await db.from('wearable_tokens').upsert(
    {
      user_id: user.id,
      provider: 'whoop',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? '',
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,provider' }
  )

  if (upsertError) {
    console.error('Whoop token upsert failed:', upsertError)
    return NextResponse.redirect(new URL(`/health?error=db_${upsertError.code}`, req.url))
  }

  const successRes = NextResponse.redirect(new URL('/health?connected=whoop', req.url))
  successRes.cookies.delete('whoop_state')
  return successRes
}
