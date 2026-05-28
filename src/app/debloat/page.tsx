export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import DebloatClient from './DebloatClient'
import { format, subDays } from 'date-fns'
import type { DebloatLog } from '@/features/debloat/types'

export default async function DebloatPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const cutoff = format(subDays(new Date(), 14), 'yyyy-MM-dd')

  const [todayResult, historyResult] = await Promise.all([
    db
      .from('debloat_logs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),
    db
      .from('debloat_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', cutoff)
      .order('date', { ascending: true }),
  ])

  return (
    <DebloatClient
      today={today}
      initialTodayLog={(todayResult.data as DebloatLog | null) ?? null}
      initialHistory={(historyResult.data as DebloatLog[]) ?? []}
    />
  )
}
