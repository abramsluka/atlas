import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { ConversationMessage } from '@/features/journal/types'
import { transcribeAudio, ensureEntryTranscript, entryContentForAI } from '@/lib/journalAudio'

export const maxDuration = 60

export async function POST(
  request: NextRequest,
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

  // Voice replies come in as multipart form data; text replies as JSON
  let message: string | undefined
  let makeLonger: boolean | undefined
  let messageIndex: number | undefined
  let replyAudioPath: string | null = null

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return new Response('No audio file', { status: 400 })

    const ext = file.name.split('.').pop() ?? 'webm'
    replyAudioPath = `${user.id}/${id}_reply_${Date.now()}.${ext}`
    const { error: uploadError } = await db.storage
      .from('journal-audio')
      .upload(replyAudioPath, file, { contentType: file.type, upsert: false })
    if (uploadError) return new Response(`Upload failed: ${uploadError.message}`, { status: 500 })

    try {
      message = await transcribeAudio(file, file.name)
    } catch (err) {
      console.error('[journal/reply] transcription failed:', err)
      await db.storage.from('journal-audio').remove([replyAudioPath])
      return new Response(`Could not transcribe recording: ${err}`, { status: 500 })
    }
    if (!message) {
      await db.storage.from('journal-audio').remove([replyAudioPath])
      return new Response('Recording was empty or unintelligible', { status: 400 })
    }
  } else {
    const body = await request.json()
    ;({ message, makeLonger, messageIndex } = body as {
      message?: string
      makeLonger?: boolean
      messageIndex?: number
    })
  }

  const existingConversation: ConversationMessage[] = entry.conversation ?? []
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let stream: ReturnType<typeof anthropic.messages.stream>

  if (makeLonger) {
    const targetIndex = messageIndex ?? -1
    const targetContent = targetIndex === -1
      ? (entry.ai_reflection ?? '')
      : (existingConversation[targetIndex]?.content ?? '')

    stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: `You are Atlas, a personal AI coach and journal companion. The user wrote this journal entry on ${entry.date}: "${entry.body}". You are expanding one of your previous responses to give the user more depth.`,
      messages: [
        {
          role: 'user',
          content: `Here is your previous response:\n\n"${targetContent}"\n\nExpand this significantly — go deeper on each point, add more specific observations and questions, and give me more to sit with. Aim for roughly 2-3x the length.`,
        },
      ],
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

          // Persist BEFORE closing the stream so the client's refetch reads fresh data
          if (fullText) {
            if (targetIndex === -1) {
              await db
                .from('journal_entries')
                .update({ ai_reflection: fullText, updated_at: new Date().toISOString() })
                .eq('id', id)
            } else {
              const updated = [...existingConversation]
              updated[targetIndex] = { role: 'assistant', content: fullText }
              await db
                .from('journal_entries')
                .update({ conversation: updated, updated_at: new Date().toISOString() })
                .eq('id', id)
            }
          }
        } finally {
          controller.close()
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

  // Normal reply — build full conversation history for context
  if (!message?.trim()) return new Response('Missing message', { status: 400 })

  // Include voice note transcript in the entry context (transcribes if needed)
  let entryTranscript: string | null = null
  try {
    entryTranscript = await ensureEntryTranscript(db, entry)
  } catch (err) {
    console.error('[journal/reply] entry transcription failed:', err)
  }
  const entryContent = entryContentForAI(entry.body, entryTranscript)

  const historyMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    {
      role: 'user',
      content: `Here is my journal entry for ${entry.date}:\n\n${entry.title ? `Title: ${entry.title}\n\n` : ''}${entryContent}`,
    },
    {
      role: 'assistant',
      content: entry.ai_reflection ?? '',
    },
    ...existingConversation.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message.trim() },
  ]

  stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `You are Atlas, a personal AI coach and journal companion. The user wrote a journal entry and you already gave an initial reflection. Now you're continuing the conversation. Be thoughtful, direct, and push them to go deeper. Don't summarize what they said back to them — just engage with it. Keep responses concise but substantive. Never use bullet points or headers.`,
    messages: historyMessages,
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

        // Persist BEFORE closing the stream so the client's refetch reads fresh data
        if (fullText) {
          const updatedConversation: ConversationMessage[] = [
            ...existingConversation,
            { role: 'user', content: message!.trim(), ...(replyAudioPath ? { audio_path: replyAudioPath } : {}) },
            { role: 'assistant', content: fullText },
          ]
          await db
            .from('journal_entries')
            .update({ conversation: updatedConversation, updated_at: new Date().toISOString() })
            .eq('id', id)
        }
      } finally {
        controller.close()
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
