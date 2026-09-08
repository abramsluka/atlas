import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/health?error=no_code', req.url))

  const tokenRes = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${req.nextUrl.origin}/api/health/oura/callback`,
      client_id: process.env.OURA_CLIENT_ID!,
      client_secret: process.env.OURA_CLIENT_SECRET!,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/health?error=token_exchange', req.url))
  }

  const tokens = await tokenRes.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  const db = createServiceClient()
  await db.from('wearable_tokens').upsert(
    {
      user_id: user.id,
      provider: 'oura',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    },
    { onConflict: 'user_id,provider' }
  )
  // One main wearable: connecting Oura replaces whatever else was connected
  // (tokens only; the other provider's cached history stays in wearable_data).
  await db.from('wearable_tokens').delete().eq('user_id', user.id).neq('provider', 'oura')

  return NextResponse.redirect(new URL('/health', req.url))
}
