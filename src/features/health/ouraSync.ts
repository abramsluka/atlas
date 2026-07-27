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
  force = false,
): Promise<OuraData | null> {
  // Check cache freshness (skipped on a forced refresh — e.g. the manual
  // refresh button, so it always re-pulls Oura's latest cloud value).
  const { data: cached } = await db
    .from('wearable_data')
    .select('data, fetched_at')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .eq('date', today)
    .maybeSingle()

  if (!force && cached) {
    const age = Date.now() - new Date(cached.fetched_at).getTime()
    const d = cached.data as OuraData
    // Only use cache if it has sleep detail data (HRV or duration); if those are
    // null the session was likely attributed to the wrong day on a previous sync.
    const hasFullData =
      (d?.sleep?.average_hrv != null || d?.sleep?.total_sleep_duration != null) &&
      (d?.sleep?.score != null || d?.readiness?.score != null)
    // A row whose score or session belongs to a previous day was cached before
    // the morning ring sync (Oura hadn't published today's docs yet). Serving it
    // for the full TTL is how the app shows yesterday's score while the phone
    // already shows today's — keep refetching until both of today's docs land.
    const isTodays = d?.sleep?.score_day === today && d?.sleep?.detail_day === today
    if (age < 15 * 60 * 1000 && hasFullData && isTodays) {
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

  // EVERY document must match TODAY exactly. Oura publishes each doc type on
  // its own lag (scores land before sleep-period detail; daily_activity often
  // lags into the next day). Any "latest available" fallback ends up serving
  // YESTERDAY's numbers mislabeled as today — the off-by-one steps/sleep bug.
  // Not published yet → nulls → UI shows '--' until Oura's cloud catches up.
  const byToday = (arr?: Array<Record<string, unknown>>) =>
    (arr ?? []).find(r => r.day === today)

  const sleepScore = byToday(sleepScoreJson?.data)
  const readiness = byToday(readinessJson?.data)

  // Activity (steps/calories) is a completed-day metric Oura finalizes on a lag —
  // today's daily_activity doc usually isn't published until the evening. Unlike
  // the sleep/readiness SCORES above (which are strictly "for today", so a
  // latest-available fallback would mislabel yesterday's score), steps only ever
  // grow toward a daily total, so the most recent available day is the right
  // value to show and matches Oura's own app. Strict today-matching here froze
  // steps at null every single day. Prefer today's doc, else the latest within
  // the 3-day fetch window.
  const activity = ((activityJson?.data ?? []) as Array<Record<string, unknown>>)
    .filter(r => typeof r.day === 'string' && (r.day as string) <= today)
    .sort((a, b) => (a.day as string).localeCompare(b.day as string))
    .at(-1)

  // The main nightly sleep is always type 'long_sleep'; short 'sleep' sessions
  // are naps or aborted recordings and must never be chosen (they wreck the
  // derived wake hour and HRV/duration). Only consider TODAY's records — if
  // last night's period doc hasn't synced yet, show nothing rather than the
  // previous night's sleep mislabeled as last night.
  const durSec = (r: Record<string, unknown>): number =>
    typeof r.total_sleep_duration === 'number' ? r.total_sleep_duration : 0
  const todaysSleeps = ((sleepDetailJson?.data ?? []) as Array<Record<string, unknown>>)
    .filter(r => r.day === today)

  const sleepDetail =
    todaysSleeps.find(r => r.type === 'long_sleep')
    // no long_sleep for today → the longest of today's sessions (never a
    // different day's record, and by duration so an evening nap can't win)
    ?? [...todaysSleeps].sort((a, b) => durSec(b) - durSec(a))[0]

  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  const readinessContrib =
    readiness && typeof readiness.contributors === 'object' && readiness.contributors !== null
      ? (readiness.contributors as Record<string, unknown>)
      : null

  const ouraData: OuraData = {
    sleep: {
      score: num(sleepScore?.score),
      score_day: typeof sleepScore?.day === 'string' ? sleepScore.day : null,
      detail_day: typeof sleepDetail?.day === 'string' ? sleepDetail.day : null,
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
      steps_day: typeof activity?.day === 'string' ? activity.day : null,
    },
  }

  await db.from('wearable_data').upsert(
    { user_id: userId, provider: 'oura', date: today, data: ouraData, fetched_at: new Date().toISOString() },
    { onConflict: 'user_id,provider,date' }
  )

  // Backfill: a past day's row freezes with null sleep detail when all of that
  // day's syncs ran before Oura published the sleep period. The fetch window
  // already spans 3 days back, so repair those rows now — wake-hour history
  // feeds the typical-wake fallback and stays useless if left frozen.
  const pastDetails = ((sleepDetailJson?.data ?? []) as Array<Record<string, unknown>>)
    .filter(r => typeof r.day === 'string' && r.day !== today && r.type === 'long_sleep')
  if (pastDetails.length > 0) {
    const { data: pastRows } = await db
      .from('wearable_data')
      .select('date, data')
      .eq('user_id', userId)
      .eq('provider', 'oura')
      .in('date', pastDetails.map(r => r.day as string))
    for (const row of pastRows ?? []) {
      const stored = row.data as OuraData
      if (stored?.sleep?.bedtime_end != null) continue
      const detail = pastDetails.find(r => r.day === row.date)!
      const patched: OuraData = {
        ...stored,
        sleep: {
          score: stored.sleep?.score ?? null,
          score_day: stored.sleep?.score_day ?? null,
          detail_day: detail.day as string,
          total_sleep_duration: num(detail.total_sleep_duration),
          average_hrv: num(detail.average_hrv),
          deep_sleep_duration: num(detail.deep_sleep_duration),
          rem_sleep_duration: num(detail.rem_sleep_duration),
          latency: num(detail.latency),
          efficiency: num(detail.efficiency),
          resting_heart_rate: num(detail.lowest_heart_rate ?? detail.average_heart_rate),
          bedtime_end: typeof detail.bedtime_end === 'string' ? detail.bedtime_end : null,
        },
      }
      await db.from('wearable_data')
        .update({ data: patched })
        .eq('user_id', userId).eq('provider', 'oura').eq('date', row.date)
    }
  }

  return ouraData
}
