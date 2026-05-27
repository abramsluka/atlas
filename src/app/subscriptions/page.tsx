import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SubscriptionsClient from './SubscriptionsClient'
import type { Subscription } from '@/features/subscriptions/types'

export const dynamic = 'force-dynamic'

export default async function SubscriptionsPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data } = await db
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  return <SubscriptionsClient initialSubscriptions={(data ?? []) as Subscription[]} />
}
