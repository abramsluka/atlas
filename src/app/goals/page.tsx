export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import GoalsClient from './GoalsClient'
import type { GoalsData } from '@/features/goals/types'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, daysAgoLocal } from '@/lib/date'

export default async function GoalsPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const thirtyDaysAgo = daysAgoLocal(30, tz)

  const [goalsResult, logsResult] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('habit_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', thirtyDaysAgo),
  ])

  const initialData: GoalsData = {
    goals: goalsResult.data ?? [],
    habitLogs: logsResult.data ?? [],
  }

  return <GoalsClient initialData={initialData} today={today} />
}
