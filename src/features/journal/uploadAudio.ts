import { createClient } from '@/lib/supabase/browser'

const BUCKET = 'journal-audio'

// Uploads a voice recording to a journal entry WITHOUT routing the bytes through
// a Next.js API route (Vercel caps serverless request bodies at 4.5 MB, which
// silently killed recordings over ~4 min). Instead:
//   1. ask the server for a signed upload URL (tiny request)
//   2. PUT the file straight to Supabase Storage (bucket limit is 25 MB)
//   3. tell the server to attach the resulting path to the entry
export async function uploadJournalAudio(
  entryId: string,
  file: File
): Promise<{ audio_url: string | null }> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'webm'

  const signRes = await fetch(`/api/journal/${entryId}/audio/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ext }),
  })
  if (!signRes.ok) {
    const j = await signRes.json().catch(() => ({}))
    throw new Error(j.error ?? 'Could not start upload')
  }
  const { path, token } = await signRes.json()

  const supabase = createClient()
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .uploadToSignedUrl(path, token, file, { contentType: file.type })
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`)

  const commitRes = await fetch(`/api/journal/${entryId}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!commitRes.ok) {
    const j = await commitRes.json().catch(() => ({}))
    throw new Error(j.error ?? 'Could not save recording')
  }
  const data = await commitRes.json()
  return { audio_url: data.audio_url ?? null }
}
