import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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
  if (!user) return NextResponse.json(null, { status: 401 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  if (!start || !end) return NextResponse.json(null)

  const db = createServiceClient()

  const { data: tokenRow } = await db
    .from('wearable_tokens')
    .select('*')
    .eq('user_id', user.id)
    .eq('provider', 'whoop')
    .maybeSingle()

  if (!tokenRow) return NextResponse.json(null)

  let accessToken = tokenRow.access_token
  if (new Date(tokenRow.expires_at) <= new Date()) {
    const newToken = await refreshWhoopToken(db, user.id, tokenRow.refresh_token)
    if (!newToken) return NextResponse.json(null)
    accessToken = newToken
  }

  const url = `https://api.prod.whoop.com/developer/v2/activity/workout?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })

  if (!res.ok) return NextResponse.json(null)
  const json = await res.json()

  const workouts: Array<Record<string, unknown>> = json?.records ?? []
  if (!workouts.length) return NextResponse.json(null)

  const w = workouts[0]
  const score = w.score as Record<string, unknown> | null | undefined
  return NextResponse.json({
    strain: score?.strain ?? null,
    average_heart_rate: score?.average_heart_rate ?? null,
    max_heart_rate: score?.max_heart_rate ?? null,
    kilojoule: score?.kilojoule ?? null,
    kcal: score?.kilojoule != null ? Math.round((score.kilojoule as number) * 0.239) : null,
  })
}
