import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { OuraData, WhoopData } from '@/features/health/types'
import type { AssistantStreamEvent } from '@/features/assistant/actions'
import { loadAssistantContext, buildAssistantTools, resolveToolCall, ACTION_RULES } from '@/features/assistant/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

interface ChatBody {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  page?: string
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { message, history = [], page = '/' } = (await req.json()) as ChatBody
  if (!message?.trim()) return new Response('message is required', { status: 400 })

  const db = createServiceClient()
  const [ctx, wearableRes, profileRes] = await Promise.all([
    loadAssistantContext(db, user.id),
    createServiceClient().from('wearable_data').select('data, provider').eq('user_id', user.id).in('provider', ['oura', 'whoop']).order('date', { ascending: false }).limit(2),
    createServiceClient().from('health_profile').select('age, weight_lbs, fitness_goal, target_weight_lbs').eq('user_id', user.id).maybeSingle(),
  ])

  // ── Recovery today (same signals the gym coach used) ──
  let readiness: number | null = null
  let sleepScore: number | null = null
  let recovery: number | null = null
  for (const row of (wearableRes.data ?? []) as Array<{ provider: string; data: Record<string, unknown> }>) {
    if (row.provider === 'oura') {
      const o = row.data as OuraData
      if (o.readiness?.score != null) readiness = o.readiness.score
      if (o.sleep?.score != null) sleepScore = o.sleep.score
    } else if (row.provider === 'whoop') {
      const w = row.data as unknown as { recovery?: { score?: number } }
      if (w.recovery?.score != null) recovery = w.recovery.score
    }
  }
  const recoveryParts: string[] = []
  if (recovery != null) recoveryParts.push(`Whoop recovery ${recovery}%`)
  if (readiness != null) recoveryParts.push(`Oura readiness ${readiness}`)
  if (sleepScore != null) recoveryParts.push(`sleep score ${sleepScore}`)
  const recoveryLine = recoveryParts.length ? recoveryParts.join(', ') : 'no wearable data synced today'

  const profile = profileRes.data as { age: number | null; weight_lbs: number | null; fitness_goal: string | null; target_weight_lbs: number | null } | null
  const profileLine = profile
    ? [profile.age && `age ${profile.age}`, profile.weight_lbs && `${profile.weight_lbs} lbs`, profile.fitness_goal && `goal: ${profile.fitness_goal}`, profile.target_weight_lbs && `target ${profile.target_weight_lbs} lbs`].filter(Boolean).join(', ')
    : 'not set'

  const onGymPage = page.startsWith('/gym')

  const system = `You are the Atlas Orb — Luka's quick-capture assistant, living in a floating chat panel available on every page of his life-OS app. Your #1 job is turning what he says (often voice transcripts) into logged data fast. Your #2 job is tactical gym coaching (you replaced his old gym coach and kept its powers: recovery-aware training calls, exercise management, programs). Direct, honest, zero fluff, references his real numbers. Be concise and decisive — this is quick capture, not a long conversation (his Mentor handles those).
${onGymPage ? '\nHe is ON THE GYM PAGE right now — lean tactical coach: give the call and the one-line reason. If recovery is low, dial back volume and say why; if high, green-light pushing.\n' : ''}
FORMATTING — this renders in a narrow phone chat bubble. Plain conversational text. NEVER use markdown tables or horizontal rules (---). Keep **bold** to the occasional key number. When you list exercises, one per line like "Bench — 105×8–12". Short and scannable beats pretty.

UNITS: ${ctx.units}.

${ACTION_RULES}

When he asks for a multi-week PROGRAM or periodized plan ("build me a program", "8-week hypertrophy block"), use the generate_program tool. Infer goal / duration / days-per-week; defaults: hypertrophy, 8 weeks, his usual days/week. That tool opens a preview he reviews — keep your text brief ("Opening an 8-week hypertrophy build — tweak it in the preview").

— CURRENT PAGE: ${page}
— TODAY'S RECOVERY: ${recoveryLine}
— PROFILE: ${profileLine}

${ctx.catalogBlock}`

  const tools = buildAssistantTools(ctx.units)

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message.trim() },
  ]

  const encoder = new TextEncoder()
  const send = (c: ReadableStreamDefaultController, e: AssistantStreamEvent) => c.enqueue(encoder.encode(JSON.stringify(e) + '\n'))

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = anthropic.messages.stream({ model: MODEL, max_tokens: 1500, system, messages, tools })
        const toolAcc: Record<number, { name: string; json: string }> = {}
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            toolAcc[event.index] = { name: event.content_block.name, json: '' }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              if (event.delta.text) send(controller, { t: 'text', v: event.delta.text })
            } else if (event.delta.type === 'input_json_delta') {
              const acc = toolAcc[event.index]
              if (acc) acc.json += event.delta.partial_json
            }
          } else if (event.type === 'content_block_stop') {
            const acc = toolAcc[event.index]
            if (acc) {
              let input: Record<string, unknown> = {}
              try { input = acc.json ? JSON.parse(acc.json) : {} } catch { input = {} }
              const resolved = resolveToolCall(acc.name, input, ctx)
              if (resolved?.type === 'action') send(controller, { t: 'action', action: resolved.action })
              else if (resolved?.type === 'clarify') send(controller, { t: 'clarify', question: resolved.question, options: resolved.options })
              delete toolAcc[event.index]
            }
          }
        }
        controller.close()
      } catch (err) {
        console.error('[assistant/chat] error:', err)
        try { send(controller, { t: 'error', v: 'Atlas hit an error. Try again.' }) } catch {}
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}
