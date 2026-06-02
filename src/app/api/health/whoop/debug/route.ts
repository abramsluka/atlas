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

  // Refresh if expired
  let accessToken = tokenRow.access_token
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
    }
  }

  const h = { Authorization: `Bearer ${accessToken}` }

  const [recoveryRes, cycleRes, sleepRes, cached] = await Promise.all([
    fetch('https://api.prod.whoop.com/developer/v1/recovery?limit=5', { headers: h }),
    fetch('https://api.prod.whoop.com/developer/v1/cycle?limit=5', { headers: h }),
    fetch('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=5', { headers: h }),
    db.from('wearable_data').select('data, fetched_at').eq('user_id', user.id).eq('provider', 'whoop').order('fetched_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  return NextResponse.json({
    token_expires_at: tokenRow.expires_at,
    token_expired: new Date(tokenRow.expires_at) <= new Date(),
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
