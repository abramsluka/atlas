import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { ensureEntryTranscript } from '@/lib/journalAudio'
import { noKeyResponse, NoApiKeyError } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'

export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: entry } = await db
    .from('journal_entries')
    .select('id, user_id, audio_path, audio_transcript, title, kind')
    .eq('id', id)
    .maybeSingle()

  if (!entry || entry.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!entry.audio_path) {
    return NextResponse.json({ error: 'No recording on this entry' }, { status: 400 })
  }

  try {
    const transcript = await ensureEntryTranscript(db, user.id, entry)
    return NextResponse.json({ transcript })
  } catch (err) {
    if (err instanceof NoApiKeyError) return noKeyResponse(err.provider)
    if (isAiLimitError(err)) return aiLimitResponse()
    console.error('[journal/transcribe] failed:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
