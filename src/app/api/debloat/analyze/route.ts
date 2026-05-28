import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    system: `You are a holistic health and wellness coach who specializes in facial bloating and inflammation. When shown a face photo, assess visible signs of bloating or puffiness — things like under-eye swelling, jawline definition, cheekbone visibility, overall facial fullness. Give honest, specific feedback on what you observe and 2–3 practical things they can do today to reduce it (gua sha technique, lymphatic drainage, hydration, sodium, sleep, etc.). If it's not a face photo, ask them to take a selfie instead. Keep it to 3–4 sentences, direct and actionable.`,
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
            text: 'Analyze my face for bloating or puffiness and tell me what to do about it.',
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
