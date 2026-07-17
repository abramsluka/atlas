import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { userIdFromSyncToken } from '@/lib/appleAuth'
import { formatInTimeZone } from 'date-fns-tz'

export const runtime = 'nodejs'

interface SyncBody {
  date?: string
  steps?: number
  active_calories?: number
  vo2_max?: number
  workouts?: Array<{
    type?: string
    start_time?: string
    duration_min?: number
    distance_mi?: number
    active_calories?: number
  }>
}

const num = (v: unknown): number | undefined => {
  const n = Number(v)
  return typeof v !== 'undefined' && v !== null && v !== '' && !Number.isNaN(n) ? n : undefined
}

export async function POST(req: NextRequest) {
  const userId = await userIdFromSyncToken(req)
  if (!userId) return NextResponse.json({ error: 'Invalid or missing sync token' }, { status: 401 })

  let body: SyncBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const db = createServiceClient()
  const tz = await getUserTimezone(userId)
  // Calendar date on purpose, NOT toLocalDate's 3 AM rollover: Apple aggregates
  // steps/calories by calendar midnight, so a post-midnight sync must not
  // overwrite yesterday's completed totals with the new day's near-zero count.
  const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')

  // ── Daily aggregate (partial merge — only overwrite fields that were sent) ──
  const daily: Record<string, unknown> = { user_id: userId, date, synced_at: new Date().toISOString() }
  const steps = num(body.steps); if (steps !== undefined) daily.steps = Math.round(steps)
  const active = num(body.active_calories); if (active !== undefined) daily.active_calories = Math.round(active)
  const vo2 = num(body.vo2_max); if (vo2 !== undefined) daily.vo2_max = vo2

  const results = { day: false, workouts: 0 }
  if (Object.keys(daily).length > 3) {
    const { error } = await db.from('apple_health_logs').upsert(daily, { onConflict: 'user_id,date' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    results.day = true
  }

  // ── Workouts (idempotent on start_time) ──
  const rows = (body.workouts ?? [])
    .filter(w => w.start_time)
    .map(w => ({
      user_id: userId,
      workout_type: w.type ?? 'workout',
      start_time: w.start_time as string,
      date: formatInTimeZone(new Date(w.start_time as string), tz, 'yyyy-MM-dd'),
      duration_min: num(w.duration_min) ?? null,
      distance_mi: num(w.distance_mi) ?? null,
      active_calories: num(w.active_calories) != null ? Math.round(num(w.active_calories)!) : null,
      synced_at: new Date().toISOString(),
    }))
  if (rows.length) {
    const { error } = await db.from('apple_workouts').upsert(rows, { onConflict: 'user_id,start_time' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    results.workouts = rows.length
  }

  return NextResponse.json({ ok: true, date, ...results })
}
