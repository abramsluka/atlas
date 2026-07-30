export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createServiceClient, getPageUser } from '@/lib/supabase/server'
import JournalClient from './JournalClient'
import type { JournalEntry } from '@/features/journal/types'

export default async function JournalPage() {
  const user = await getPageUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data } = await db
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  return <JournalClient initialData={(data ?? []) as JournalEntry[]} />
}
