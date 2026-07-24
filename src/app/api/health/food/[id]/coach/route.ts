import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'

export const runtime = 'nodejs'
export const maxDuration = 15

const SYSTEM_PROMPT = `You are a terse, direct nutrition coach inside a personal health app. The user just logged a meal. Give 1-2 sentences of honest, specific feedback — what's good about it, any notable macros, a quick suggestion if relevant. No filler, no "Great job!", no emojis. Under 40 words.`

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: log, error } = await db
    .from('food_logs')
    .select('user_id, item_name, calories, protein_g, carbs_g, fat_g, taken_at, notes')
    .eq('id', id)
    .single()

  if (error || !log) return new Response('Not found', { status: 404 })
  if (log.user_id !== user.id) return new Response('Forbidden', { status: 403 })

  const takenAt = log.taken_at ? new Date(log.taken_at) : new Date()
  const hour = takenAt.getHours()
  const timeLabel =
    hour < 10 ? 'morning' : hour < 13 ? 'midday' : hour < 17 ? 'afternoon' : 'evening'

  const parts = [
    `${log.item_name} — ${log.calories} cal`,
    `${Math.round(Number(log.protein_g))}g protein`,
    `${Math.round(Number(log.carbs_g))}g carbs`,
    log.fat_g != null ? `${Math.round(Number(log.fat_g))}g fat` : null,
    `logged at ${timeLabel}`,
  ].filter(Boolean).join(', ')

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: parts }],
  })

  let accumulated = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const text = event.delta.text
            accumulated += text
            controller.enqueue(new TextEncoder().encode(text))
          }
        }
        await db
          .from('food_logs')
          .update({ coach_feedback: accumulated })
          .eq('id', id)
      } catch (err) {
        console.error('[food/[id]/coach] stream error:', err)
        controller.error(err)
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
