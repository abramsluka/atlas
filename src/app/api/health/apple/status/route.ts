export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const [daysRes, latestRes, todayRes, workoutsRes] = await Promise.all([
    db.from('apple_health_logs').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
    db.from('apple_health_logs').select('date, steps, active_calories, vo2_max, synced_at').eq('user_id', user.id).order('date', { ascending: false }).limit(1).maybeSingle(),
    db.from('apple_health_logs').select('steps').eq('user_id', user.id).eq('date', today).maybeSingle(),
    db.from('apple_workouts').select('workout_type, date, duration_min, distance_mi, active_calories').eq('user_id', user.id).order('start_time', { ascending: false }).limit(5),
  ])

  const latest = latestRes.data as { date: string; steps: number | null; active_calories: number | null; vo2_max: number | null; synced_at: string } | null

  return NextResponse.json({
    daysOfData: daysRes.count ?? 0,
    lastSync: latest?.synced_at ?? null,
    todaySteps: (todayRes.data as { steps: number | null } | null)?.steps ?? null,
    latest: latest ? { date: latest.date, steps: latest.steps, active_calories: latest.active_calories, vo2_max: latest.vo2_max } : null,
    recentWorkouts: workoutsRes.data ?? [],
  })
}
