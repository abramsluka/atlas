import type { createServiceClient } from '@/lib/supabase/server'
import { generateTitle } from '@/lib/journalTitle'

type Db = ReturnType<typeof createServiceClient>

const BUCKET = 'journal-audio'

export async function transcribeAudio(audio: Blob, filename: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set — add it to .env.local and restart the dev server')
  }
  const fd = new FormData()
  fd.append('file', audio, filename)
  fd.append('model', 'gpt-4o-transcribe')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: fd,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Transcription failed (${res.status}): ${text}`)
  }
  const json = await res.json()
  return (json.text ?? '').trim()
}

// Transcribes the entry's recording if it hasn't been transcribed yet, persists, returns transcript.
// Untitled entries also get a short generated title from the transcript.
export async function ensureEntryTranscript(
  db: Db,
  entry: { id: string; audio_path: string | null; audio_transcript: string | null; title?: string | null; kind?: string | null }
): Promise<string | null> {
  if (!entry.audio_path) return null
  if (entry.audio_transcript) return entry.audio_transcript

  const { data: file, error } = await db.storage.from(BUCKET).download(entry.audio_path)
  if (error || !file) throw new Error(`Could not download audio: ${error?.message ?? 'no file'}`)

  const filename = entry.audio_path.split('/').pop() ?? 'audio.webm'
  const transcript = await transcribeAudio(file, filename)

  const title = !entry.title && transcript
    ? await generateTitle(transcript, entry.kind === 'morning' ? 'plan' : 'entry')
    : null

  await db
    .from('journal_entries')
    .update({
      audio_transcript: transcript,
      ...(title ? { title } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entry.id)

  return transcript
}

// The text the AI should treat as the entry's content (typed body and/or voice transcript)
export function entryContentForAI(body: string | null, transcript: string | null): string {
  const parts: string[] = []
  if (body?.trim()) parts.push(body.trim())
  if (transcript?.trim()) parts.push(`[Voice note transcript]\n${transcript.trim()}`)
  return parts.join('\n\n')
}

// Attach short-lived signed URLs for the entry recording and any voice replies in the conversation
export async function withAudioUrls<
  T extends { audio_path?: string | null; conversation?: Array<{ audio_path?: string | null }> | null }
>(db: Db, entry: T): Promise<T & { audio_url?: string | null }> {
  const result: T & { audio_url?: string | null } = { ...entry }

  if (entry.audio_path) {
    const { data } = await db.storage.from(BUCKET).createSignedUrl(entry.audio_path, 3600)
    result.audio_url = data?.signedUrl ?? null
  }

  const conv = entry.conversation ?? []
  if (conv.some(m => m.audio_path)) {
    result.conversation = await Promise.all(
      conv.map(async m => {
        if (!m.audio_path) return m
        const { data } = await db.storage.from(BUCKET).createSignedUrl(m.audio_path, 3600)
        return { ...m, audio_url: data?.signedUrl ?? null }
      })
    )
  }

  return result
}
