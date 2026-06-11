import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getOuraForDate, summarizeOuraForDate } from '@/features/health/ouraContext'
import { ensureEntryTranscript, entryContentForAI } from '@/lib/journalAudio'

export const maxDuration = 60

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = createServiceClient()
  const { data: entry, error } = await db
    .from('journal_entries')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !entry) return new Response('Not found', { status: 404 })

  // Voice entries: transcribe before reflecting (no-op if already transcribed or no audio)
  let transcript: string | null = null
  try {
    transcript = await ensureEntryTranscript(db, entry)
  } catch (err) {
    console.error('[journal/reflect] transcription failed:', err)
    if (!entry.body?.trim()) return new Response(`Could not transcribe recording: ${err}`, { status: 500 })
  }

  const content = entryContentForAI(entry.body, transcript)
  if (!content) return new Response('Entry has no content', { status: 400 })

  // Pull Oura data for the entry's date (if any)
  const ouraForDay = await getOuraForDate(db, user.id, entry.date)
  const bodySummary = summarizeOuraForDate(ouraForDay)

  const userMessage = `Here is my journal entry for ${entry.date}:\n\n${entry.title ? `Title: ${entry.title}\n\n` : ''}${content}${bodySummary ? `\n\n[Body data for this day: ${bodySummary}]` : ''}`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are Atlas, a personal AI coach. The user has just written a journal entry. Read it carefully and give a short, honest reflection — 2–3 sentences, no more. You are not a therapist. Sound like a thoughtful friend who actually read what they wrote. Be direct. If something stands out, say so. If body data (sleep, readiness, HRV) is provided and it's notable — low sleep, big HRV drop, low readiness — weave it into your reflection naturally where it's relevant, but don't list it out. End with one open question that might be worth sitting with. Never use bullet points or headers.`,
    messages: [{ role: 'user', content: userMessage }],
  })

  let fullText = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const chunk = event.delta.text
            fullText += chunk
            controller.enqueue(new TextEncoder().encode(chunk))
          }
        }
      } finally {
        controller.close()
      }

      if (fullText) {
        await db
          .from('journal_entries')
          .update({ ai_reflection: fullText, updated_at: new Date().toISOString() })
          .eq('id', id)
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
