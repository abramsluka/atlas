import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import HealthClient from './HealthClient'
import type { OuraData, WhoopData } from '@/features/health/types'

export default async function HealthPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = new Date().toISOString().split('T')[0]

  const [
    supplementsResult,
    logsResult,
    waterResult,
    caffeineResult,
    profileResult,
    ouraTokenResult,
    whoopTokenResult,
  ] = await Promise.all([
    db.from('supplements').select('*').eq('user_id', user.id).eq('active', true).order('created_at', { ascending: true }),
    db.from('supplement_logs').select('*').eq('user_id', user.id).eq('date', today),
    db.from('water_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('caffeine_logs').select('*').eq('user_id', user.id).eq('date', today).order('logged_at', { ascending: true }),
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'oura').maybeSingle(),
    db.from('wearable_tokens').select('provider').eq('user_id', user.id).eq('provider', 'whoop').maybeSingle(),
  ])

  const hasOura = !!ouraTokenResult.data
  const hasWhoop = !!whoopTokenResult.data

  // Load cached wearable data if tokens exist
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
    const rawOura = (ouraCache.data?.data as OuraData) ?? null
    const ouraHasData =
      rawOura &&
      (rawOura.sleep?.score != null ||
        rawOura.sleep?.total_sleep_duration != null ||
        rawOura.sleep?.average_hrv != null ||
        rawOura.readiness?.score != null)
    ouraData = ouraHasData ? rawOura : null
    whoopData = (whoopCache.data?.data as WhoopData) ?? null
  }

  return (
    <HealthClient
      supplements={supplementsResult.data ?? []}
      todayLogs={logsResult.data ?? []}
      todayWater={waterResult.data ?? []}
      todayCaffeine={caffeineResult.data ?? []}
      profile={profileResult.data ?? null}
      ouraData={ouraData}
      whoopData={whoopData}
      hasOura={hasOura}
      hasWhoop={hasWhoop}
      today={today}
    />
  )
}
