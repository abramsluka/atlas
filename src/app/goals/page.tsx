export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import GoalsClient from './GoalsClient'
import type { GoalsData } from '@/features/goals/types'
import { format, subDays } from 'date-fns'

export default async function GoalsPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd')

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
