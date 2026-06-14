import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import HealthClient from './HealthClient'
import type { OuraData, WhoopData } from '@/features/health/types'
import type { WorkoutPoint, MealPoint } from '@/features/health/energyModel'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const todayStart = `${today}T00:00:00`
  const todayEnd   = `${today}T23:59:59`

  const [
    supplementsResult,
    logsResult,
    waterResult,
    caffeineResult,
    profileResult,
    ouraTokenResult,
    whoopTokenResult,
    workoutsResult,
    foodResult,
  ] = await Promise.all([
    db.from('supplements').select('*').eq('user_id', user.id).eq('active', true).order('created_at', { ascending: true }),
    db.from('supplement_logs').select('*').eq('user_id', user.id).eq('date', today),
    db.from('water_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('caffeine_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'oura').maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'whoop').maybeSingle(),
    // Workouts + food feed the same energy model the caffeine page uses, so the
    // compact card reads identically to Today's Curve.
    db.from('workouts')
      .select('id, name, completed_at, exercises(id, sets(reps, weight_lbs, completed))')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', todayStart)
      .lte('completed_at', todayEnd),
    db.from('food_logs')
      .select('id, item_name, calories, taken_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('taken_at', { ascending: true }),
  ])

  const hasOura = !!ouraTokenResult.data
  const hasWhoop = !!whoopTokenResult.data

  // Load cached wearable data if tokens exist
  let ouraData: OuraData | null = null
  let whoopData: WhoopData | null = null

  if (hasOura || hasWhoop) {
    const [ouraCache, whoopCache] = await Promise.all([
      hasOura
        ? db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'oura').eq('date', today).maybeSingle()
        : Promise.resolve({ data: null }),
      hasWhoop
        ? db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'whoop').eq('date', today).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const rawOura = (ouraCache.data?.data as OuraData) ?? null
    const ouraHasData =
      rawOura &&
      (rawOura.sleep?.score != null ||
        rawOura.sleep?.total_sleep_duration != null ||
        rawOura.sleep?.average_hrv != null ||
        rawOura.readiness?.score != null)
    ouraData = ouraHasData ? rawOura : null
    whoopData = (whoopCache.data?.data as WhoopData) ?? null
  }

  const workoutPoints: WorkoutPoint[] = (workoutsResult.data ?? []).map((w: Record<string, unknown>) => {
    const d = new Date(w.completed_at as string)
    const exercises = (w.exercises as Array<{ sets: Array<{ reps: number | null; weight_lbs: number | null; completed: boolean }> }>) ?? []
    let volumeLbs = 0
    for (const ex of exercises) {
      for (const s of ex.sets ?? []) {
        if (s.completed && s.reps != null && s.weight_lbs != null) volumeLbs += s.reps * s.weight_lbs
      }
    }
    return {
      id: w.id as string,
      name: (w.name as string | null) ?? null,
      completedHour: d.getHours() + d.getMinutes() / 60,
      volumeLbs,
    }
  })

  const mealPoints: MealPoint[] = (foodResult.data ?? [])
    .filter((f: { calories: number | null }) => f.calories != null && f.calories > 0)
    .map((f: { id: string; item_name: string | null; calories: number | null; taken_at: string }) => {
      const d = new Date(f.taken_at)
      return { id: f.id, hour: d.getHours() + d.getMinutes() / 60, calories: f.calories!, name: f.item_name ?? 'Meal' }
    })

  return (
    <HealthClient
      workouts={workoutPoints}
      meals={mealPoints}
      supplements={supplementsResult.data ?? []}
      todayLogs={logsResult.data ?? []}
      todayWater={waterResult.data ?? []}
      todayCaffeine={caffeineResult.data ?? []}
      profile={profileResult.data ?? null}
      ouraData={ouraData}
      whoopData={whoopData}
      hasOura={hasOura}
      hasWhoop={hasWhoop}
      today={today}
    />
  )
}
