import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { OuraData, OuraHistoryPoint } from '@/features/health/types'
import { getActiveWearableProvider } from '@/features/health/wearableProvider'

async function refreshOuraToken(
  db: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
  userId: string,
  refreshToken: string,
) {
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

  const url = new URL(req.url)
  const days = Math.min(60, Math.max(7, parseInt(url.searchParams.get('days') ?? '14', 10)))

  const db = createServiceClient()
  const end = new Date()
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const startStr = start.toISOString().split('T')[0]
  const endStr = end.toISOString().split('T')[0]

  // WHOOP: no API call here. whoopSync already backfills one normalized
  // wearable_data row per day, so the chart reads straight from the cache.
  const provider = await getActiveWearableProvider(db, user.id)
  if (provider === 'whoop') {
    const { data: rows } = await db
      .from('wearable_data')
      .select('date, data')
      .eq('user_id', user.id)
      .eq('provider', 'whoop')
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date', { ascending: true })

    const points: OuraHistoryPoint[] = ((rows ?? []) as Array<{ date: string; data: OuraData }>).map(({ date, data }) => ({
      date,
      readiness: data?.readiness?.score ?? null,
      sleep_score: data?.sleep?.score ?? null,
      hrv: data?.sleep?.average_hrv ?? null,
    }))
    return NextResponse.json(points)
  }

  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'oura')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json([])

  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshOuraToken(db, user.id, tokenRow.refresh_token)
    if (!newToken) return NextResponse.json([])
    accessToken = newToken
  }

  const headers = { Authorization: `Bearer ${accessToken}` }

  const [sleepScoreRes, sleepDetailRes, readinessRes] = await Promise.all([
    fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${startStr}&end_date=${endStr}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/sleep?start_date=${startStr}&end_date=${endStr}`, { headers }),
    fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${startStr}&end_date=${endStr}`, { headers }),
  ])

  const [sleepScoreJson, sleepDetailJson, readinessJson] = await Promise.all([
    sleepScoreRes.ok ? sleepScoreRes.json() : null,
    sleepDetailRes.ok ? sleepDetailRes.json() : null,
    readinessRes.ok ? readinessRes.json() : null,
  ])

  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

  const byDay = new Map<string, OuraHistoryPoint>()
  const ensure = (day: string): OuraHistoryPoint => {
    let p = byDay.get(day)
    if (!p) {
      p = { date: day, readiness: null, sleep_score: null, hrv: null }
      byDay.set(day, p)
    }
    return p
  }

  for (const row of (sleepScoreJson?.data ?? []) as Array<Record<string, unknown>>) {
    const day = typeof row.day === 'string' ? row.day : null
    if (!day) continue
    ensure(day).sleep_score = num(row.score)
  }

  for (const row of (readinessJson?.data ?? []) as Array<Record<string, unknown>>) {
    const day = typeof row.day === 'string' ? row.day : null
    if (!day) continue
    ensure(day).readiness = num(row.score)
  }

  for (const row of (sleepDetailJson?.data ?? []) as Array<Record<string, unknown>>) {
    const day = typeof row.day === 'string' ? row.day : null
    if (!day) continue
    const hrv = num(row.average_hrv)
    if (hrv != null) ensure(day).hrv = hrv
  }

  const points = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date))
  return NextResponse.json(points)
}
