import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format, subHours } from 'date-fns'
import FoodHistoryClient from './FoodHistoryClient'

function rolledDate(): string {
  const now = new Date()
  const adjusted = now.getHours() < 6 ? subHours(now, 6) : now
  return format(adjusted, 'yyyy-MM-dd')
}

export default async function FoodHistoryPage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = rolledDate()

  const { data: logs } = await db
    .from('food_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .order('taken_at', { ascending: false })

  const withUrls = await Promise.all(
    (logs ?? []).map(async (log) => {
      if (!log.storage_path) return { ...log, photo_url: null }
      const { data } = await db.storage.from('food-photos').createSignedUrl(log.storage_path, 3600)
      return { ...log, photo_url: data?.signedUrl ?? null }
    }),
  )

  return <FoodHistoryClient initialLogs={withUrls} today={today} />
}
