import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import type { OuraData, WhoopData } from '@/features/health/types'
import CaffeineClient from './CaffeineClient'

export const dynamic = 'force-dynamic'

export default async function CaffeinePage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const [caffeineResult, ouraTokenResult, whoopTokenResult] = await Promise.all([
    db.from('caffeine_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'oura').maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'whoop').maybeSingle(),
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

  return (
    <CaffeineClient
      initialCaffeine={caffeineResult.data ?? []}
      today={today}
      ouraData={ouraData}
      whoopData={whoopData}
    />
  )
}
