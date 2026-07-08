import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const BUCKET = 'journal-audio'

// Commit an audio recording to a journal entry. The bytes are uploaded straight
// from the browser to Supabase Storage via a signed URL (see ./sign), so this
// route only receives the resulting storage path — no large body, no Vercel
// 4.5 MB limit.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: entry } = await db
    .from('journal_entries')
    .select('id, user_id, audio_path')
    .eq('id', id)
    .maybeSingle()

  if (!entry || entry.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const path: unknown = body.path
  // Path must be the one we handed out: this user's folder, this entry.
  if (typeof path !== 'string' || !path.startsWith(`${user.id}/${id}_`)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  // Confirm the object actually landed in storage before we point the entry at it.
  const { data: signed, error: signErr } = await db.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)
  if (signErr || !signed) {
    return NextResponse.json({ error: 'Recording not found in storage' }, { status: 400 })
  }

  // Replace any previous recording; transcript no longer matches, so clear it.
  const previousPath = entry.audio_path

  const { data: updated, error: dbError } = await db
    .from('journal_entries')
    .update({ audio_path: path, audio_transcript: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (dbError) {
    await db.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  if (previousPath && previousPath !== path) {
    await db.storage.from(BUCKET).remove([previousPath])
  }

  return NextResponse.json({ ...updated, audio_url: signed.signedUrl })
}
