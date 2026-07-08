import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const BUCKET = 'journal-audio'
const ALLOWED_EXT = new Set(['webm', 'mp4', 'm4a', 'mp3', 'wav', 'ogg'])

// Issues a signed upload URL so the browser can PUT the audio straight to
// Supabase Storage. This bypasses the Vercel serverless 4.5 MB request-body
// limit that was silently killing recordings longer than ~4 min.
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
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle()

  if (!entry || entry.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  const rawExt = typeof body.ext === 'string' ? body.ext.toLowerCase() : 'webm'
  const ext = ALLOWED_EXT.has(rawExt) ? rawExt : 'webm'
  const infix = body.reply ? '_reply_' : '_'

  const path = `${user.id}/${id}${infix}${Date.now()}.${ext}`

  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Could not create upload URL' }, { status: 500 })
  }

  return NextResponse.json({ path: data.path, token: data.token })
}
