export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeHabits } from '@/lib/habits/compute'
import HabitsClient from './HabitsClient'

export default async function HabitsPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const habits = await computeHabits(db, user.id, tz)

  return <HabitsClient initial={habits} />
}
