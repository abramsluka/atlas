import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { toLocalDate } from '@/lib/date'
import { getUserTimezone } from '@/lib/getUserTimezone'
import FoodHistoryClient from './FoodHistoryClient'

export default async function FoodHistoryPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const today = toLocalDate(await getUserTimezone(user.id))

  const { data: logs } = await db
    .from('food_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', today)
    .order('taken_at', { ascending: false })

  const withUrls = await Promise.all(
    (logs ?? []).map(async ({ search_tsv: _tsv, ...log }) => {
      if (!log.storage_path) return { ...log, photo_url: null }
      const { data } = await db.storage.from('food-photos').createSignedUrl(log.storage_path, 3600)
      return { ...log, photo_url: data?.signedUrl ?? null }
    }),
  )

  return <FoodHistoryClient initialLogs={withUrls} today={today} />
}
