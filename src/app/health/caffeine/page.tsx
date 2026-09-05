import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toEnergyDate, nextCalendarDate, isoToEnergyDayHour, energyDayUtcWindow } from '@/features/health/energyModel'
import { getTypicalWakeHour } from '@/features/health/typicalWake'
import type { OuraData } from '@/features/health/types'
import type { FoodLog } from '@/features/food/types'
import { sessionLabel, sessionVolumeLbs, type GymActivityLog } from '@/lib/gymActivity'
import CaffeineClient from './CaffeineClient'

export const dynamic = 'force-dynamic'

export interface WorkoutPoint {
  id: string
  completedHour: number   // local hour (0–24) when workout finished
  volumeLbs: number       // total lifted volume = sum(reps * weight_lbs) for the workout
  name: string | null
}

export interface MealPoint {
  id: string
  hour: number            // local hour of meal
  calories: number
  name: string
}

export default async function CaffeinePage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  // Energy day: before 3am you are still living yesterday's curve
  const today = toEnergyDate(tz)
  const tomorrow = nextCalendarDate(today)

  // The energy day spans [today 3am, tomorrow 3am) local — resolve to real UTC
  // instants so timestamp windows catch post-midnight sets and meals.
  const { start: dayStart, end: dayEnd } = energyDayUtcWindow(today, tz)

  const [caffeineResult, wearableTokensResult, workoutsResult, foodResult, ratingsResult, typicalWakeHour] = await Promise.all([
    // Post-midnight doses can carry either date tag depending on where they
    // were logged from; the hour mapping folds both onto this energy day.
    db.from('caffeine_logs')
      .select('*')
      .eq('user_id', user.id)
      .in('date', [today, tomorrow])
      .order('logged_at', { ascending: true }),

    // One main wearable at a time (the OAuth callbacks delete the other's
    // token row); a legacy account could still hold both, so prefer whoop.
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).limit(2),

    // Fetch this energy day's gym_logs for volume calculation
    db.from('gym_logs')
      .select('logged_at, weight, reps, gym_exercises(name)')
      .eq('user_id', user.id)
      .gte('logged_at', dayStart)
      .lt('logged_at', dayEnd)
      .order('logged_at', { ascending: false }),

    // Fetch this energy day's food logs for postprandial dip
    db.from('food_logs')
      .select('id, item_name, calories, taken_at')
      .eq('user_id', user.id)
      .gte('taken_at', dayStart)
      .lt('taken_at', dayEnd)
      .order('taken_at', { ascending: true }),

    // Fetch today's subjective energy ratings
    db.from('energy_ratings')
      .select('*')
      .eq('user_id', user.id)
      .eq('date_key', today)
      .order('logged_at', { ascending: true }),

    // Median wake hour from recent Oura history — fallback for mornings
    // where the ring hasn't synced yet
    getTypicalWakeHour(db, user.id, tz),
  ])

  const tokenRows = (wearableTokensResult.data ?? []) as Array<{ provider: string }>
  const provider = tokenRows.some((r) => r.provider === 'whoop') ? 'whoop'
    : tokenRows.some((r) => r.provider === 'oura') ? 'oura'
    : null
  const hasOura = provider != null

  let ouraData: OuraData | null = null

  if (provider) {
    const ouraCache = await db
      .from('wearable_data').select('data')
      .eq('user_id', user.id).eq('provider', provider).eq('date', today).maybeSingle()
    ouraData = (ouraCache.data?.data as OuraData) ?? null
  }

  // Build WorkoutPoints — today's gym_logs collapse into a single session
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

  // Build MealPoints
  const mealPoints: MealPoint[] = (foodResult.data ?? [])
    .filter((f: Partial<FoodLog>) => f.calories != null && f.calories > 0)
    .map((f: Partial<FoodLog>) => ({
      id: f.id!,
      hour: isoToEnergyDayHour(f.taken_at!, tz),
      calories: f.calories!,
      name: f.item_name ?? 'Meal',
    }))

  return (
    <CaffeineClient
      initialCaffeine={caffeineResult.data ?? []}
      initialRatings={ratingsResult.data ?? []}
      today={today}
      ouraData={ouraData}
      workouts={workoutPoints}
      meals={mealPoints}
      typicalWakeHour={typicalWakeHour}
    />
  )
}
