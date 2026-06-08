import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { WhoopData } from '@/features/health/types'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

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
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  // Check cache first (fresh = within 15 min)
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', user.id)
    .eq('provider', 'whoop')
    .eq('date', today)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    const d = cached.data as WhoopData | null
    const hasRealData = d?.recovery?.score != null || d?.cycle?.strain != null
    if (age < 15 * 60 * 1000 && hasRealData) {
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

  if (!tokenRow) return NextResponse.json({ error: 'auth' }, { status: 401 })

  // Refresh if expired
  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshWhoopToken(db, user.id, tokenRow.refresh_token)
    if (!newToken) return NextResponse.json({ error: 'auth' }, { status: 401 })
    accessToken = newToken
  }

  const headers = { Authorization: `Bearer ${accessToken}` }

  const [recoveryRes, cycleRes, sleepRes] = await Promise.all([
    fetch('https://api.prod.whoop.com/developer/v1/recovery?limit=5', { headers }),
    fetch('https://api.prod.whoop.com/developer/v1/cycle?limit=5', { headers }),
    fetch('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=5', { headers }),
  ])

  if (recoveryRes.status === 404 && sleepRes.status === 404 && cycleRes.status === 200) {
    console.warn('[whoop/data] recovery+sleep both 404 while cycle OK — likely missing OAuth scopes. Use Reconnect Whoop in settings.')
  }

  // Only 401 means bad token — 404 means no data for this user (e.g. no sleep tracking)
  if (recoveryRes.status === 401 || cycleRes.status === 401 || sleepRes.status === 401) {
    return NextResponse.json({ error: 'auth' }, { status: 401 })
  }

  const [recoveryJson, cycleJson, sleepJson] = await Promise.all([
    recoveryRes.status === 200 ? recoveryRes.json() : null,
    cycleRes.status === 200 ? cycleRes.json() : null,
    sleepRes.status === 200 ? sleepRes.json() : null,
  ])

  // Pick the most recent record from each endpoint
  const pickLatest = (records?: Array<Record<string, unknown>>): Record<string, unknown> | undefined =>
    records?.slice().sort((a, b) => String(b.end ?? b.created_at ?? '').localeCompare(String(a.end ?? a.created_at ?? '')))[0]

  const recoveryRecord = pickLatest(recoveryJson?.records)
  const cycleRecord = pickLatest(cycleJson?.records)
  const sleepRecord =
    sleepJson?.records?.find((r: Record<string, unknown>) => r.nap === false) ??
    sleepJson?.records?.[0]

  const rScore = recoveryRecord?.score as Record<string, unknown> | null | undefined
  const cScore = cycleRecord?.score as Record<string, unknown> | null | undefined
  const sScore = sleepRecord?.score as Record<string, unknown> | null | undefined
  const stageSummary = sScore?.stage_summary as Record<string, unknown> | null | undefined

  const whoopData: WhoopData = {
    recovery: recoveryRecord
      ? {
          score: (rScore?.recovery_score as number | null) ?? null,
          hrv_rmssd_milli: (rScore?.hrv_rmssd_milli as number | null) ?? null,
          resting_heart_rate: (rScore?.resting_heart_rate as number | null) ?? null,
        }
      : undefined,
    cycle: cycleRecord
      ? {
          strain: (cScore?.strain as number | null) ?? null,
          kilojoule: (cScore?.kilojoule as number | null) ?? null,
        }
      : undefined,
    sleep: sleepRecord
      ? {
          duration_seconds: stageSummary?.total_in_bed_time_milli != null
            ? Math.round(stageSummary.total_in_bed_time_milli as number / 1000)
            : null,
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
