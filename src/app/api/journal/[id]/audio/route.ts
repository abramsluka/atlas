import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Attach (or replace) the voice recording on a journal entry
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

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const ext = file.name.split('.').pop() ?? 'webm'
  const storagePath = `${user.id}/${id}_${Date.now()}.${ext}`

  const { error: uploadError } = await db.storage
    .from('journal-audio')
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  // Replace any previous recording; transcript no longer matches, so clear it
  if (entry.audio_path) {
    await db.storage.from('journal-audio').remove([entry.audio_path])
  }

  const { data: updated, error: dbError } = await db
    .from('journal_entries')
    .update({ audio_path: storagePath, audio_transcript: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (dbError) {
    await db.storage.from('journal-audio').remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  const { data: signed } = await db.storage
    .from('journal-audio')
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json({ ...updated, audio_url: signed?.signedUrl ?? null })
}
