import { redirect } from 'next/navigation'
import { resolveWearableProvider, WEARABLE_PROVIDERS } from '@/features/health/wearableProvider'
import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import HealthClient from './HealthClient'
import type { OuraData } from '@/features/health/types'
import { toEnergyDate, nextCalendarDate, isoToEnergyDayHour, energyDayUtcWindow, type WorkoutPoint, type MealPoint } from '@/features/health/energyModel'
import { getTypicalWakeHour } from '@/features/health/typicalWake'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { sessionLabel, sessionVolumeLbs, type GymActivityLog } from '@/lib/gymActivity'

export const dynamic = 'force-dynamic'

// The wearable OAuth callbacks bounce here with ?error=… on failure. Until now
// that was silent, which made a friend's first failed connect indistinguishable
// from "nothing happened". Keep the copy short and honest about which step broke.
function wearableErrorMessage(code: string | undefined): string | null {
  if (!code) return null
  if (code === 'fitbit_not_configured') return 'Fitbit is not set up on this Atlas yet (missing developer app credentials).'
  if (code === 'token_exchange') return 'The wearable connected but Atlas could not exchange the login for a token. Try again; if it persists, the app credentials may be wrong.'
  if (code === 'bad_state') return 'That connect attempt expired or was tampered with. Start it again from this page.'
  if (code === 'no_code') return 'The wearable did not return a login code. Try connecting again.'
  const m = /^(oura|whoop|fitbit)_(.+)$/.exec(code)
  if (m) return `${m[1] === 'oura' ? 'Oura' : m[1] === 'whoop' ? 'WHOOP' : 'Fitbit'} refused the connection (${m[2].replace(/_/g, ' ')}).`
  return null
}

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const errorMessage = wearableErrorMessage((await searchParams).error)
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  // Energy day (3am rollover, same boundary as rolledDate): before 3am the
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
    ouraCacheResult,
    workoutsResult,
    foodResult,
    typicalWakeHour,
    savedMealsResult,
    userIngredientsResult,
  ] = await Promise.all([
    db.from('supplements').select('*').eq('user_id', user.id).eq('active', true).order('created_at', { ascending: true }),
    db.from('supplement_logs').select('*').eq('user_id', user.id).eq('date', today),
    db.from('water_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('caffeine_logs').select('*').eq('user_id', user.id).in('date', [today, nextCalendarDate(today)]).order('logged_at', { ascending: true }),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    // Whichever wearable is connected (Oura or WHOOP) — the callbacks keep this
    // to one row, but limit(2) guards a legacy account holding both.
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).limit(3),
    // Cached Oura payload fetched unconditionally (PK lookup) so it rides this
    // Promise.all instead of adding a serial round-trip after it; only used
    // when a token row exists.
    db.from('wearable_data').select('data, provider').eq('user_id', user.id).in('provider', WEARABLE_PROVIDERS).eq('date', today).limit(3),
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
    getTypicalWakeHour(db, user.id, tz),
    // Meal-builder data, loaded here rather than when the sheet mounts: it used
    // to fire two client fetches on open, so saved meals popped in after the
    // sheet had already animated up. Free wall-clock — this Promise.all is
    // already waiting on slower queries.
    // Limits mirror the GET routes exactly, so a later refetch returns the
    // same rows as the seeded cache.
    db.from('saved_meals').select('*').eq('user_id', user.id).order('last_used_at', { ascending: false }).limit(100),
    db.from('user_ingredients').select('*').eq('user_id', user.id).order('last_used_at', { ascending: false }).limit(200),
  ])

  const wearableProvider = resolveWearableProvider(ouraTokenResult.data as Array<{ provider: string }> | null)
  const hasOura = wearableProvider != null

  // Use the cached wearable data only if a token exists
  let ouraData: OuraData | null = null

  if (hasOura) {
    const cacheRows = (ouraCacheResult.data ?? []) as Array<{ provider: string; data: OuraData }>
    const rawOura = cacheRows.find((r) => r.provider === wearableProvider)?.data ?? null
    const ouraHasData =
      rawOura &&
      (rawOura.sleep?.score != null ||
        rawOura.sleep?.total_sleep_duration != null ||
        rawOura.sleep?.average_hrv != null ||
        rawOura.readiness?.score != null)
    ouraData = ouraHasData ? rawOura : null
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
    <>
      {errorMessage && (
        <div className="mx-4 mt-4 rounded-xl border border-red-400/25 bg-red-400/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed text-red-200/90">
          {errorMessage}
        </div>
      )}
    <HealthClient
      workouts={workoutPoints}
      meals={mealPoints}
      supplements={supplementsResult.data ?? []}
      todayLogs={logsResult.data ?? []}
      todayWater={waterResult.data ?? []}
      todayCaffeine={caffeineResult.data ?? []}
      profile={profileResult.data ?? null}
      ouraData={ouraData}
      wearableProvider={wearableProvider}
      today={today}
      typicalWakeHour={typicalWakeHour}
      savedMeals={savedMealsResult.data ?? []}
      userIngredients={userIngredientsResult.data ?? []}
    />
    </>
  )
}
