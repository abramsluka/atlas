import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

// Shared speech-to-text handler: multipart FormData field `audio` → { text }.
// Used by /api/assistant/transcribe and /api/mentor/transcribe.
export async function handleTranscribeRequest(req: NextRequest): Promise<NextResponse> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio')

    if (!audioFile) {
      return NextResponse.json({ error: 'audio file required' }, { status: 400 })
    }

    const file = audioFile instanceof File
      ? audioFile
      : new File([audioFile as unknown as Blob], 'audio.webm', { type: 'audio/webm' })

    const openai = getOpenAI()
    const transcription = await openai.audio.transcriptions.create({
      model: 'gpt-4o-transcribe',
      file,
    })

    return NextResponse.json({ text: transcription.text })
  } catch (e) {
    console.error('transcription failed', e)
    return NextResponse.json({ error: 'Transcription failed' }, { status: 500 })
  }
}
