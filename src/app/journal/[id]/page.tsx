export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import EntryDetail from './EntryDetail'
import type { JournalEntry } from '@/features/journal/types'
import { withAudioUrls } from '@/lib/journalAudio'

export default async function JournalEntryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const { data } = await db
    .from('journal_entries')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!data || data.user_id !== user.id) notFound()

  const entry = await withAudioUrls(db, data)
  return <EntryDetail initialEntry={entry as JournalEntry} />
}
