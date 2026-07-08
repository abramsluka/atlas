import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import HealthClient from './HealthClient'
import type { OuraData, WhoopData } from '@/features/health/types'
import { toEnergyDate, nextCalendarDate, isoToEnergyDayHour, energyDayUtcWindow, type WorkoutPoint, type MealPoint } from '@/features/health/energyModel'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { sessionLabel, sessionVolumeLbs, type GymActivityLog } from '@/lib/gymActivity'

export const dynamic = 'force-dynamic'

export default async function HealthPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  // Energy day (6am rollover, same boundary as rolledDate): before 6am the
  // whole page still shows the day being lived — water/supplement totals
  // don't reset at midnight while you're up, and now match the client-side
  // rolledDate() the water/supplement sections already use.
  const today = toEnergyDate(tz)
  const { start: dayStart, end: dayEnd } = energyDayUtcWindow(today, tz)

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
    db.from('caffeine_logs').select('*').eq('user_id', user.id).in('date', [today, nextCalendarDate(today)]).order('logged_at', { ascending: true }),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'oura').maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'whoop').maybeSingle(),
    // Training + food feed the same energy model the caffeine page uses, so the
    // compact card reads identically to Today's Curve.
    db.from('gym_logs')
      .select('logged_at, weight, reps, gym_exercises(name)')
      .eq('user_id', user.id)
      .gte('logged_at', dayStart)
      .lt('logged_at', dayEnd)
      .order('logged_at', { ascending: false }),
    db.from('food_logs')
      .select('id, item_name, calories, taken_at')
      .eq('user_id', user.id)
      .gte('taken_at', dayStart)
      .lt('taken_at', dayEnd)
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
    workoutPoints.push({
      id: `gym-${today}`,
      name: sessionLabel(gymLogs),
      completedHour: isoToEnergyDayHour(gymLogs[0].logged_at, tz),
      volumeLbs: sessionVolumeLbs(gymLogs),
    })
  }

  const mealPoints: MealPoint[] = (foodResult.data ?? [])
    .filter((f: { calories: number | null }) => f.calories != null && f.calories > 0)
    .map((f: { id: string; item_name: string | null; calories: number | null; taken_at: string }) =>
      ({ id: f.id, hour: isoToEnergyDayHour(f.taken_at, tz), calories: f.calories!, name: f.item_name ?? 'Meal' }))

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
