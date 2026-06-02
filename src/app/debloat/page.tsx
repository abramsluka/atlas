export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import DebloatClient from './DebloatClient'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, daysAgoLocal } from '@/lib/date'
import type { DebloatLog } from '@/features/debloat/types'

export default async function DebloatPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const cutoff = daysAgoLocal(14, tz)

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
