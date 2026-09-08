import { redirect } from 'next/navigation'
import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import { getUserProviders } from '@/lib/userKeys'
import OnboardingClient from './OnboardingClient'

export const dynamic = 'force-dynamic'

export default async function OnboardingPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const [settingsRes, profileRes, habitsRes, gymRes, providers] = await Promise.all([
    db.from('user_settings').select('first_name, onboarding_completed_at').eq('user_id', user.id).maybeSingle(),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('habits').select('id').eq('user_id', user.id).eq('active', true).limit(1),
    db.from('gym_config').select('user_id').eq('user_id', user.id).maybeSingle(),
    getUserProviders(user.id),
  ])

  // Already done: never trap someone in a wizard they finished. They can still
  // replay the walkthrough from Settings.
  if (settingsRes.data?.onboarding_completed_at) redirect('/')

  const profile = profileRes.data
  const hasKey = providers.length > 0
  const hasProfile = !!(profile?.weight_lbs && profile?.age && profile?.sex)
  const hasTargets = !!profile?.daily_calorie_target
  const hasHabits = (habitsRes.data?.length ?? 0) > 0

  // Resume by deriving the step from what data actually exists, rather than
  // persisting a step counter that can drift out of sync with reality.
  //
  // Deliberately monotonic — resume just past the FURTHEST thing they finished,
  // not at the first thing they are missing. Someone who skipped the API key on
  // purpose and then filled in their profile must not be dumped back on the key
  // step every time they reopen the tab. Gym and wearable are not part of the
  // derivation at all: hardly anyone sets them, so including them would strand
  // every returning user on the gym step forever.
  let initialStep = 0
  if (hasHabits) initialStep = 5
  else if (hasTargets) initialStep = 4
  else if (hasProfile) initialStep = 3
  else if (hasKey) initialStep = 2

  const rawFirst = (settingsRes.data?.first_name as string | null)?.trim() || ''
  const firstName = rawFirst ? rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1) : ''

  return (
    <OnboardingClient
      firstName={firstName}
      initialStep={initialStep}
      hasKey={hasKey}
      hasGymConfig={!!gymRes.data}
      initialProfile={{
        age: profile?.age ?? null,
        sex: (profile?.sex as string | null) ?? null,
        height_cm: profile?.height_cm ?? null,
        weight_lbs: profile?.weight_lbs ?? null,
        activity_hrs_per_week: profile?.activity_hrs_per_week ?? null,
        fitness_goal: (profile?.fitness_goal as string | null) ?? null,
        target_weight_lbs: profile?.target_weight_lbs ?? null,
        cut_pace: (profile?.cut_pace as string | null) ?? null,
        daily_calorie_target: profile?.daily_calorie_target ?? null,
        daily_protein_target_g: profile?.daily_protein_target_g ?? null,
        daily_carbs_target_g: profile?.daily_carbs_target_g ?? null,
        target_reasoning: (profile?.target_reasoning as string | null) ?? null,
      }}
    />
  )
}
