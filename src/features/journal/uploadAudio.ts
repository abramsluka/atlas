import { createClient } from '@/lib/supabase/browser'

const BUCKET = 'journal-audio'

// Sign + PUT the file straight to Supabase Storage, bypassing the Next.js API
// route (Vercel caps serverless request bodies at 4.5 MB, which silently killed
// recordings over ~4 min). Returns the resulting storage path.
export async function uploadAudioToStorage(
  entryId: string,
  file: File,
  opts?: { reply?: boolean }
): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'webm'

  const signRes = await fetch(`/api/journal/${entryId}/audio/sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ext, reply: opts?.reply ?? false }),
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

  return path
}

// For the entry's main voice note: upload the bytes, then attach the path to the
// entry (the commit route only sees a tiny JSON body).
export async function uploadJournalAudio(
  entryId: string,
  file: File
): Promise<{ audio_url: string | null }> {
  const path = await uploadAudioToStorage(entryId, file)

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
