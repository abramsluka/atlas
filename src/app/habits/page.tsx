export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeHabits } from '@/lib/habits/compute'
import HabitsClient from './HabitsClient'

export default async function HabitsPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const habits = await computeHabits(db, user.id, tz)

  return <HabitsClient initial={habits} />
}
