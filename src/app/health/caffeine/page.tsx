import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import type { OuraData, WhoopData } from '@/features/health/types'
import type { FoodLog } from '@/features/food/types'
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
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  // Build start-of-day and end-of-day in UTC for today's date window
  // We use a 24h window around today's date — workouts completed_at is a timestamp
  const todayStart = `${today}T00:00:00`
  const todayEnd   = `${today}T23:59:59`

  const [caffeineResult, ouraTokenResult, whoopTokenResult, workoutsResult, foodResult, ratingsResult] = await Promise.all([
    db.from('caffeine_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('logged_at', { ascending: true }),

    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'oura').maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'whoop').maybeSingle(),

    // Fetch today's completed workouts with their sets for volume calculation
    db.from('workouts')
      .select('id, name, completed_at, exercises(id, sets(reps, weight_lbs, completed))')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', todayStart)
      .lte('completed_at', todayEnd),

    // Fetch today's food logs for postprandial dip
    db.from('food_logs')
      .select('id, item_name, calories, taken_at')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('taken_at', { ascending: true }),

    // Fetch today's subjective energy ratings
    db.from('energy_ratings')
      .select('*')
      .eq('user_id', user.id)
      .eq('date_key', today)
      .order('logged_at', { ascending: true }),
  ])

  const hasOura = !!ouraTokenResult.data
  const hasWhoop = !!whoopTokenResult.data

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
    ouraData = (ouraCache.data?.data as OuraData) ?? null
    whoopData = (whoopCache.data?.data as WhoopData) ?? null
  }

  // Build WorkoutPoints — compute volume from sets
  const workoutPoints: WorkoutPoint[] = (workoutsResult.data ?? []).map((w: Record<string, unknown>) => {
    const completedAt = w.completed_at as string
    const d = new Date(completedAt)
    const completedHour = d.getHours() + d.getMinutes() / 60

    const exercises = (w.exercises as Array<{ sets: Array<{ reps: number | null; weight_lbs: number | null; completed: boolean }> }>) ?? []
    let volumeLbs = 0
    for (const ex of exercises) {
      for (const s of ex.sets ?? []) {
        if (s.completed && s.reps != null && s.weight_lbs != null) {
          volumeLbs += s.reps * s.weight_lbs
        }
      }
    }

    return {
      id: w.id as string,
      name: (w.name as string | null) ?? null,
      completedHour,
      volumeLbs,
    }
  })

  // Build MealPoints
  const mealPoints: MealPoint[] = (foodResult.data ?? [])
    .filter((f: Partial<FoodLog>) => f.calories != null && f.calories > 0)
    .map((f: Partial<FoodLog>) => {
      const d = new Date(f.taken_at!)
      return {
        id: f.id!,
        hour: d.getHours() + d.getMinutes() / 60,
        calories: f.calories!,
        name: f.item_name ?? 'Meal',
      }
    })

  return (
    <CaffeineClient
      initialCaffeine={caffeineResult.data ?? []}
      initialRatings={ratingsResult.data ?? []}
      today={today}
      ouraData={ouraData}
      whoopData={whoopData}
      workouts={workoutPoints}
      meals={mealPoints}
    />
  )
}
