import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { WhoopData } from '@/features/health/types'

async function refreshWhoopToken(db: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>, userId: string, refreshToken: string) {
  const res = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) return null
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  await db.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
  }).eq('user_id', userId).eq('provider', 'whoop')
  return tokens.access_token as string
}

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const today = new Date().toISOString().split('T')[0]

  // Check cache first (fresh = within 1 hour)
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', user.id)
    .eq('provider', 'whoop')
    .eq('date', today)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < 60 * 60 * 1000) {
      return NextResponse.json(cached.data)
    }
  }

  // Get token
  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'whoop')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json(null)

  // Refresh if expired
  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshWhoopToken(db, user.id, tokenRow.refresh_token)
    if (!newToken) return NextResponse.json(null)
    accessToken = newToken
  }

  const headers = { Authorization: `Bearer ${accessToken}` }

  // Fetch recovery and most recent workout in parallel
  const [recoveryRes, workoutRes] = await Promise.all([
    fetch(`https://api.prod.whoop.com/developer/v1/recovery?start=${today}T00:00:00.000Z&end=${today}T23:59:59.000Z`, { headers }),
    fetch('https://api.prod.whoop.com/developer/v1/activity/workout?limit=1', { headers }),
  ])

  const [recoveryJson, workoutJson] = await Promise.all([
    recoveryRes.ok ? recoveryRes.json() : null,
    workoutRes.ok ? workoutRes.json() : null,
  ])

  const recoveryRecord = recoveryJson?.records?.[0]
  const workoutRecord = workoutJson?.records?.[0]

  const whoopData: WhoopData = {
    recovery: recoveryRecord
      ? {
          score: recoveryRecord.score?.recovery_score ?? null,
          hrv_rmssd_milli: recoveryRecord.score?.hrv_rmssd_milli ?? null,
        }
      : undefined,
    workout: workoutRecord
      ? {
          strain: workoutRecord.score?.strain ?? null,
          kilojoule: workoutRecord.kilojoule ?? null,
        }
      : undefined,
  }

  // Cache result
  await db.from('wearable_data').upsert(
    { user_id: user.id, provider: 'whoop', date: today, data: whoopData, fetched_at: new Date().toISOString() },
    { onConflict: 'user_id,provider,date' }
  )

  return NextResponse.json(whoopData)
}
