import type { SupabaseClient } from '@supabase/supabase-js'
import { entryContentForAI } from '@/lib/journalAudio'
import { extractFacts } from './extractFacts'

/**
 * Idempotent journal → profile ingestion. Safe to call from every journal write
 * path: it no-ops unless the entry has never been ingested or has been edited
 * since. Voice entries with no transcript yet get picked up by the transcribe
 * hook instead.
 */
export async function ingestJournalEntry(
  db: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<void> {
  try {
    const { data: entry } = await db
      .from('journal_entries')
      .select('id, user_id, date, title, body, audio_transcript, updated_at, profile_ingested_at')
      .eq('id', entryId)
      .maybeSingle()

    if (!entry || entry.user_id !== userId) return

    if (entry.profile_ingested_at && entry.updated_at && entry.updated_at <= entry.profile_ingested_at) {
      return
    }

    const content = entryContentForAI(entry.body, entry.audio_transcript)
    if (!content.trim()) return

    await extractFacts(db, userId, {
      sourceKind: 'journal',
      sourceId: entry.id,
      content: entry.title ? `${entry.title}\n\n${content}` : content,
      occurredAt: entry.date,
    })

    await db
      .from('journal_entries')
      .update({ profile_ingested_at: new Date().toISOString() })
      .eq('id', entryId)
  } catch (e) {
    console.error('[profile/ingestJournalEntry] failed:', e)
  }
}
