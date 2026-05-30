import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { OuraData } from '@/features/health/types'

async function refreshOuraToken(db: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>, userId: string, refreshToken: string) {
  const res = await fetch('https://api.ouraring.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.OURA_CLIENT_ID!,
      client_secret: process.env.OURA_CLIENT_SECRET!,
    }),
  })
  if (!res.ok) return null
  const tokens = await res.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
  await db.from('wearable_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
  }).eq('user_id', userId).eq('provider', 'oura')
  return tokens.access_token as string
}

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const today = new Date().toISOString().split('T')[0]
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  // Check cache first (fresh = within 1 hour, and only if it has real data)
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', user.id)
    .eq('provider', 'oura')
    .eq('date', today)
    .maybeSingle()

  const cachedData = cached?.data as OuraData | undefined
  const cachedHasData =
    cachedData &&
    (cachedData.sleep?.score != null ||
      cachedData.sleep?.total_sleep_duration != null ||
      cachedData.sleep?.average_hrv != null ||
      cachedData.readiness?.score != null ||
      cachedData.activity?.steps != null)

  if (cached && cachedHasData) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    if (age < 15 * 60 * 1000) {
      return NextResponse.json(cached.data)
    }
  }

  // Get token
  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'oura')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json(null)

  // Refresh if expired
  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshOuraToken(db, user.id, tokenRow.refresh_token)
    if (!newToken) return NextResponse.json(null)
    accessToken = newToken
  }

  const headers = { Authorization: `Bearer ${accessToken}` }

  // Query a 3-day window; Oura's daily summaries lag by hours and querying only
  // "today" frequently returns an empty array.
  const [sleepScoreRes, sleepDetailRes, readinessRes, activityRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${threeDaysAgo}&end_date=${today}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${threeDaysAgo}&end_date=${today}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${threeDaysAgo}&end_date=${today}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${threeDaysAgo}&end_date=${today}`, { headers }),
  ])

  const [sleepScoreJson, sleepDetailJson, readinessJson, activityJson] = await Promise.all([
    sleepScoreRes.ok ? sleepScoreRes.json() : null,
    sleepDetailRes.ok ? sleepDetailRes.json() : null,
    readinessRes.ok ? readinessRes.json() : null,
    activityRes.ok ? activityRes.json() : null,
  ])

  // Pick the most recent daily entry
  const pickLatest = (arr?: Array<Record<string, unknown>>): Record<string, unknown> | undefined => {
    if (!arr || arr.length === 0) return undefined
    return [...arr].sort((a, b) => String(b.day ?? b.bedtime_end ?? '').localeCompare(String(a.day ?? a.bedtime_end ?? '')))[0]
  }

  const sleepScore = pickLatest(sleepScoreJson?.data)
  const readiness = pickLatest(readinessJson?.data)
  const activity = pickLatest(activityJson?.data)

  // Match sleepDetail (from /sleep) to the same calendar day as the sleepScore record.
  // The /sleep endpoint returns individual sleep periods; the daily_sleep score refers to
  // the night ending on `sleepScore.day`, so we match on `day` (Oura sets day = wake date).
  const scoreDay = sleepScore?.day as string | undefined
  const sleepDetailRecords: Array<Record<string, unknown>> = sleepDetailJson?.data ?? []
  // Oura v2 /sleep records use `type` ("long_sleep", "rest", "nap", etc.), not a `nap` boolean.
  // Prefer long_sleep for the same day as the score; fall back to any non-nap; then any same-day record.
  const sleepDetail: Record<string, unknown> | undefined = scoreDay
    ? (sleepDetailRecords
        .filter(r => r.day === scoreDay && r.type === 'long_sleep')
        .sort((a, b) => String(b.bedtime_end ?? '').localeCompare(String(a.bedtime_end ?? '')))[0]
      ?? sleepDetailRecords
        .filter(r => r.day === scoreDay && r.type !== 'nap')
        .sort((a, b) => String(b.bedtime_end ?? '').localeCompare(String(a.bedtime_end ?? '')))[0]
      ?? sleepDetailRecords
        .filter(r => r.day === scoreDay)
        .sort((a, b) => String(b.bedtime_end ?? '').localeCompare(String(a.bedtime_end ?? '')))[0])
    : pickLatest(sleepDetailRecords)

  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

  // readiness `contributors.body_temperature` is an Oura contributor score (50–100).
  // `temperature_deviation` is on the sleep period record, but exposed by the
  // readiness daily endpoint via `temperature_deviation` on some accounts.
  const readinessContrib =
    readiness && typeof readiness.contributors === 'object' && readiness.contributors !== null
      ? (readiness.contributors as Record<string, unknown>)
      : null

  const ouraData: OuraData = {
    sleep: {
      score: num(sleepScore?.score),
      total_sleep_duration: num(sleepDetail?.total_sleep_duration),
      average_hrv: num(sleepDetail?.average_hrv),
      deep_sleep_duration: num(sleepDetail?.deep_sleep_duration),
      rem_sleep_duration: num(sleepDetail?.rem_sleep_duration),
      latency: num(sleepDetail?.latency),
      efficiency: num(sleepDetail?.efficiency),
      resting_heart_rate: num(sleepDetail?.lowest_heart_rate ?? sleepDetail?.average_heart_rate),
    },
    readiness: {
      score: num(readiness?.score),
      temperature_deviation: num(readiness?.temperature_deviation ?? readinessContrib?.body_temperature),
    },
    activity: {
      steps: num(activity?.steps),
      active_calories: num(activity?.active_calories),
      total_calories: num(activity?.total_calories),
    },
  }

  // Cache result
  await db.from('wearable_data').upsert(
    { user_id: user.id, provider: 'oura', date: today, data: ouraData, fetched_at: new Date().toISOString() },
    { onConflict: 'user_id,provider,date' }
  )

  return NextResponse.json(ouraData)
}
