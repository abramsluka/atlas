import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, AI_LIMIT_MESSAGE } from '@/lib/aiErrors'

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const { imageBase64, mediaType } = body

  if (!imageBase64 || !mediaType) {
    return new Response('Missing image data', { status: 400 })
  }

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  if (!validTypes.includes(mediaType)) {
    return new Response('Unsupported image type', { status: 400 })
  }

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are a personal wellness assistant helping someone track how their face looks day to day — things like puffiness around the eyes, jawline sharpness, cheek fullness, and overall facial water retention. This is a self-monitoring habit, like weighing yourself daily. The person is not asking for medical advice — they just want honest observations about what they can see in today's photo and simple lifestyle reminders that commonly help with facial puffiness (like hydration, sodium, sleep position, gua sha, lymphatic drainage massage, or morning cold water).

When shown a selfie: describe what you notice about their facial fullness today in 1–2 sentences (be specific and direct — mention the eyes, jawline, or cheeks by name), then give 2–3 practical things they can do today based on what you see. Be a straight-talking wellness coach, not a cautious doctor. If it is not a face photo, just ask them to take a selfie instead. Keep the whole response under 5 sentences.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: imageBase64,
            },
          },
          {
            type: 'text',
            text: 'Here is my face today. How does it look in terms of puffiness, and what should I do about it?',
          },
        ],
      },
    ],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } catch (err) {
        if (isAiLimitError(err)) {
          try { controller.enqueue(new TextEncoder().encode(AI_LIMIT_MESSAGE)) } catch {}
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
