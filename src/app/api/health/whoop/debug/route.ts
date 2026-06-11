import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'whoop')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json({ error: 'No token' })

  let tokenScopes: string | null = null
  try {
    const payload = JSON.parse(Buffer.from(tokenRow.access_token.split('.')[1], 'base64url').toString())
    tokenScopes = payload.scope ?? payload.scopes ?? null
  } catch {
    tokenScopes = 'could not decode JWT'
  }

  // Refresh if expired — save back to DB so the data route benefits too
  let accessToken = tokenRow.access_token
  let refreshError: string | null = null
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.WHOOP_CLIENT_ID!,
        client_secret: process.env.WHOOP_CLIENT_SECRET!,
      }),
    })
    if (res.ok) {
      const tokens = await res.json()
      accessToken = tokens.access_token
      const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
      await db.from('wearable_tokens').update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      }).eq('user_id', user.id).eq('provider', 'whoop')
    } else {
      refreshError = await res.text().catch(() => res.statusText)
      console.error('[whoop/debug] refresh failed:', res.status, refreshError)
      return NextResponse.json({
        token_expires_at: tokenRow.expires_at,
        token_expired: true,
        refresh_failed: true,
        refresh_error: refreshError,
        diagnosis: 'Token expired and refresh_token is invalid. Use Reconnect Whoop in settings.',
      })
    }
  }

  const h = { Authorization: `Bearer ${accessToken}` }

  const [recoveryRes, cycleRes, sleepRes, cached] = await Promise.all([
    fetch('https://api.prod.whoop.com/developer/v2/recovery?limit=5', { headers: h }),
    fetch('https://api.prod.whoop.com/developer/v2/cycle?limit=5', { headers: h }),
    fetch('https://api.prod.whoop.com/developer/v2/activity/sleep?limit=5', { headers: h }),
    db.from('wearable_data').select('data, fetched_at').eq('user_id', user.id).eq('provider', 'whoop').order('fetched_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const anyFailed = recoveryRes.status !== 200 || sleepRes.status !== 200 || cycleRes.status !== 200

  return NextResponse.json({
    token_expires_at: tokenRow.expires_at,
    token_expired: new Date(tokenRow.expires_at) <= new Date(),
    token_scopes: tokenScopes,
    diagnosis: anyFailed
      ? 'One or more v2 endpoints failed. 401 = bad token (reconnect Whoop). 404 on v2 = no data recorded for that type yet.'
      : 'OK — all v2 endpoints returning data',
    cached_data: cached.data,
    recovery: {
      status: recoveryRes.status,
      body: recoveryRes.ok ? await recoveryRes.json() : await recoveryRes.text(),
    },
    cycle: {
      status: cycleRes.status,
      body: cycleRes.ok ? await cycleRes.json() : await cycleRes.text(),
    },
    sleep: {
      status: sleepRes.status,
      body: sleepRes.ok ? await sleepRes.json() : await sleepRes.text(),
    },
  })
}
