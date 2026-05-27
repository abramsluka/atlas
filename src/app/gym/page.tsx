export const dynamic = 'force-dynamic'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatInTimeZone } from 'date-fns-tz'
import GymClient from './GymClient'
import type { GymConfig, GymExercise, BodyWeight } from '@/features/gym/types'

export default async function GymPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = formatInTimeZone(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd')

  const [configRes, exercisesRes, bodyWeightsRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', user.id).order('order_index').order('created_at'),
    db.from('body_weights').select('*').eq('user_id', user.id).order('date_key'),
  ])

  const defaultConfig: GymConfig = {
    gyms: [{ id: 'g_default', name: 'Gym' }],
    days: [
      { id: 'd_push', name: 'Push' },
      { id: 'd_pull', name: 'Pull' },
      { id: 'd_legs', name: 'Legs' },
    ],
    split_rotation: ['Push', 'Pull', 'Legs', 'Rest'],
    split_anchor: null,
    units: 'lbs',
    upgrade_at_reps: 12,
  }

  return (
    <GymClient
      today={today}
      initialConfig={(configRes.data as GymConfig | null) ?? defaultConfig}
      initialExercises={(exercisesRes.data as GymExercise[] | null) ?? []}
      initialBodyWeights={(bodyWeightsRes.data as BodyWeight[] | null) ?? []}
    />
  )
}
