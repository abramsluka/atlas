import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import HealthClient from './HealthClient'
import type { OuraData, WhoopData } from '@/features/health/types'
import type { WorkoutPoint, MealPoint } from '@/features/health/energyModel'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { sessionLabel, sessionVolumeLbs, type GymActivityLog } from '@/lib/gymActivity'

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
    // Training + food feed the same energy model the caffeine page uses, so the
    // compact card reads identically to Today's Curve.
    db.from('gym_logs')
      .select('logged_at, weight, reps, gym_exercises(name)')
      .eq('user_id', user.id)
      .gte('logged_at', todayStart)
      .lte('logged_at', todayEnd)
      .order('logged_at', { ascending: false }),
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

  // Today's gym_logs collapse into a single session point for the energy model
  const gymLogs = (workoutsResult.data ?? []) as unknown as GymActivityLog[]
  const workoutPoints: WorkoutPoint[] = []
  if (gymLogs.length > 0) {
    const lastLog = new Date(gymLogs[0].logged_at)
    workoutPoints.push({
      id: `gym-${today}`,
      name: sessionLabel(gymLogs),
      completedHour: lastLog.getHours() + lastLog.getMinutes() / 60,
      volumeLbs: sessionVolumeLbs(gymLogs),
    })
  }

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
