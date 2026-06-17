import type { OuraData } from './types'

type DbClient = ReturnType<typeof import('@/lib/supabase/server').createServiceClient>

async function refreshOuraToken(
  db: DbClient,
  userId: string,
  refreshToken: string,
): Promise<string | null> {
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

/**
 * Fetch fresh Oura data for today, update the cache, and return the data.
 * If the cache is already fresh (<15 min), returns the cached data without hitting Oura.
 * Returns null if no token is available or the fetch fails.
 */
export async function syncOuraToday(
  db: DbClient,
  userId: string,
  today: string,
): Promise<OuraData | null> {
  // Check cache freshness
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .eq('date', today)
    .maybeSingle()

  if (cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    const d = cached.data as OuraData
    // Only use cache if it has sleep detail data (HRV or duration); if those are
    // null the session was likely attributed to the wrong day on a previous sync.
    const hasFullData =
      (d?.sleep?.average_hrv != null || d?.sleep?.total_sleep_duration != null) &&
      (d?.sleep?.score != null || d?.readiness?.score != null)
    if (age < 15 * 60 * 1000 && hasFullData) {
      return d
    }
  }

  // Fetch token
  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .maybeSingle()

  if (!tokenRow) return null

  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshOuraToken(db, userId, tokenRow.refresh_token)
    if (!newToken) return null
    accessToken = newToken
  }

  const headers = { Authorization: `Bearer ${accessToken}` }
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

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

  const pickLatest = (arr?: Array<Record<string, unknown>>) => {
    if (!arr?.length) return undefined
    return [...arr].sort((a, b) =>
      String(b.day ?? b.bedtime_end ?? '').localeCompare(String(a.day ?? a.bedtime_end ?? ''))
    )[0]
  }

  const sleepScore = pickLatest(sleepScoreJson?.data)
  const readiness = pickLatest(readinessJson?.data)
  const activity = pickLatest(activityJson?.data)

  const scoreDay = sleepScore?.day as string | undefined
  const sleepDetailRecords: Array<Record<string, unknown>> = sleepDetailJson?.data ?? []

  // The main nightly sleep is always type 'long_sleep'. The short 'sleep' sessions
  // are naps or aborted recordings — some only a few minutes long and ending in the
  // evening — and must never be chosen: picking one wrecks the derived wake hour
  // (which then zeroes the whole energy curve) and the HRV/duration. Oura also
  // publishes the daily_sleep score before the matching sleep *period* detail
  // syncs, so the newest long_sleep can lag the score by a day.
  const durSec = (r: Record<string, unknown>): number =>
    typeof r.total_sleep_duration === 'number' ? r.total_sleep_duration : 0
  const longSleeps = sleepDetailRecords
    .filter(r => r.type === 'long_sleep')
    .sort((a, b) => String(b.bedtime_end ?? '').localeCompare(String(a.bedtime_end ?? '')))

  const sleepDetail =
    // 1. the long_sleep for the score's day
    longSleeps.find(r => r.day === scoreDay)
    // 2. otherwise the most recent long_sleep we have (detail often lags the score)
    ?? longSleeps[0]
    // 3. only if no long_sleep exists at all, the longest session by actual sleep
    //    duration — never the latest, which would favour an evening nap
    ?? [...sleepDetailRecords].sort((a, b) => durSec(b) - durSec(a))[0]

  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
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
      bedtime_end: typeof sleepDetail?.bedtime_end === 'string' ? sleepDetail.bedtime_end : null,
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

  await db.from('wearable_data').upsert(
    { user_id: userId, provider: 'oura', date: today, data: ouraData, fetched_at: new Date().toISOString() },
    { onConflict: 'user_id,provider,date' }
  )

  return ouraData
}
