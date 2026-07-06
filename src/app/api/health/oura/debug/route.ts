import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

// Diagnostic route: dumps the raw Oura sleep responses so we can see why the
// wrong session is being matched. The OAuth token never leaves the server —
// only the sleep data is returned/logged. Open this once in the browser; the
// compact summary is also written to the dev log.
export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'oura')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json({ error: 'No Oura token — connect Oura first' })

  // Refresh if expired (save back so the real sync benefits too)
  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const res = await fetch('https://api.ouraring.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokenRow.refresh_token,
        client_id: process.env.OURA_CLIENT_ID!,
        client_secret: process.env.OURA_CLIENT_SECRET!,
      }),
    })
    if (!res.ok) {
      return NextResponse.json({
        token_expired: true,
        refresh_failed: true,
        refresh_error: await res.text().catch(() => res.statusText),
        diagnosis: 'Token expired and refresh failed. Reconnect Oura in settings.',
      })
    }
    const tokens = await res.json()
    accessToken = tokens.access_token
    await db.from('wearable_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    }).eq('user_id', user.id).eq('provider', 'oura')
  }

  const headers = { Authorization: `Bearer ${accessToken}` }
  // Look back a week so we can see how sessions are attributed across days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  const [sleepScoreRes, sleepDetailRes, readinessRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${weekAgo}&end_date=${today}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${weekAgo}&end_date=${today}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${weekAgo}&end_date=${today}`, { headers }),
  ])

  const sleepScoreJson = sleepScoreRes.ok ? await sleepScoreRes.json() : null
  const sleepDetailJson = sleepDetailRes.ok ? await sleepDetailRes.json() : null
  const readinessJson = readinessRes.ok ? await readinessRes.json() : null

  type Rec = Record<string, unknown>
  const dailySleep: Rec[] = sleepScoreJson?.data ?? []
  const sleepDetail: Rec[] = sleepDetailJson?.data ?? []

  // Compact view of every sleep-detail session
  const sessions = sleepDetail.map(r => ({
    day: r.day,
    type: r.type,
    bedtime_start: r.bedtime_start,
    bedtime_end: r.bedtime_end,
    total_sleep_h: typeof r.total_sleep_duration === 'number' ? +(r.total_sleep_duration / 3600).toFixed(2) : null,
    average_hrv: r.average_hrv,
  }))
  const scores = dailySleep.map(r => ({ day: r.day, score: r.score }))

  // What the CURRENT matcher in ouraSync would pick: everything is gated to
  // day === today. Not published yet → null → the card shows '--'.
  const durSec = (r: Rec): number => (typeof r.total_sleep_duration === 'number' ? r.total_sleep_duration : 0)
  const todaysSleeps = sleepDetail.filter(r => r.day === today)
  const currentPick =
    todaysSleeps.find(r => r.type === 'long_sleep')
    ?? [...todaysSleeps].sort((a, b) => durSec(b) - durSec(a))[0]
    ?? null
  const todayScore = dailySleep.find(r => r.day === today) ?? null

  const summary = {
    today,
    todays_sleep_score: todayScore ? todayScore.score : null,
    score_days: scores,
    sessions,
    current_matcher_picks: currentPick
      ? { day: currentPick.day, type: currentPick.type, bedtime_end: currentPick.bedtime_end }
      : null,
    diagnosis: currentPick
      ? 'Today has a sleep-detail record — the card shows it.'
      : `No sleep-detail record for ${today} in Oura's cloud yet (scores publish before session detail). Slept shows '--' until it lands — open the Oura app to push the ring's data up, then refresh.`,
  }

  console.log('[oura/debug]', JSON.stringify(summary, null, 2))

  return NextResponse.json({
    ...summary,
    statuses: {
      daily_sleep: sleepScoreRes.status,
      sleep: sleepDetailRes.status,
      daily_readiness: readinessRes.status,
    },
    raw: {
      daily_sleep: dailySleep,
      sleep: sleepDetail,
      daily_readiness: readinessJson?.data ?? null,
    },
  })
}
