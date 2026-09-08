import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, AI_LIMIT_MESSAGE } from '@/lib/aiErrors'
import type { OuraData } from '@/features/health/types'
import { describeAction, type AssistantStreamEvent } from '@/features/assistant/actions'
import { loadAssistantContext, buildAssistantTools, resolveToolCall, ACTION_RULES } from '@/features/assistant/tools'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'
import { getLiveSession, liveSessionBlock, type LiveSession } from '@/lib/liveGymSession'
import { getActiveWearableProvider, WEARABLE_LABEL, WEARABLE_PROVIDERS } from '@/features/health/wearableProvider'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

interface ChatBody {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  page?: string
  // Client-side context the server can't derive: local hour + gym-timer state.
  context?: { hour?: number; inGymSession?: boolean; sessionMinutes?: number }
  source?: 'voice' | 'text' | 'chip'
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { message, history = [], page = '/', context, source } = (await req.json()) as ChatBody
  if (!message?.trim()) return new Response('message is required', { status: 400 })

  const db = createServiceClient()
  const [ctx, wearableRes, profileRes, profileBlock, liveSession, activeProvider] = await Promise.all([
    loadAssistantContext(db, user.id),
    createServiceClient().from('wearable_data').select('data, provider').eq('user_id', user.id).in('provider', WEARABLE_PROVIDERS).order('date', { ascending: false }).limit(4),
    createServiceClient().from('health_profile').select('age, weight_lbs, fitness_goal, target_weight_lbs').eq('user_id', user.id).maybeSingle(),
    getProfileBlock(db, user.id, 'assistant'),
    // Server-derived mid-workout state. The client's inGymSession comes from the
    // Gym page's localStorage timer, so it only knows about the device it runs
    // on and can't see which sets he's actually put in.
    getLiveSession(db, user.id),
    getActiveWearableProvider(db, user.id),
  ])

  // ── Recovery today (from Oura or WHOOP — both land in the same OuraData shape) ──
  // Read ONLY the active provider: on a switch day both providers can have a row
  // for the same date, and row order between equal dates is undefined, so
  // accepting both would pick a winner at random.
  const wearableProvider = activeProvider ?? 'oura'
  let readiness: number | null = null
  let sleepScore: number | null = null
  for (const row of (wearableRes.data ?? []) as Array<{ provider: string; data: Record<string, unknown> }>) {
    if (row.provider === wearableProvider) {
      const o = row.data as OuraData
      if (o.readiness?.score != null) readiness = o.readiness.score
      if (o.sleep?.score != null) sleepScore = o.sleep.score
    }
  }
  const recoveryParts: string[] = []
  if (readiness != null) recoveryParts.push(`${WEARABLE_LABEL[wearableProvider].recovery} ${readiness}`)
  if (sleepScore != null) recoveryParts.push(`sleep score ${sleepScore}`)
  const recoveryLine = recoveryParts.length ? recoveryParts.join(', ') : 'no wearable data synced today'

  const profile = profileRes.data as { age: number | null; weight_lbs: number | null; fitness_goal: string | null; target_weight_lbs: number | null } | null
  const profileLine = profile
    ? [profile.age && `age ${profile.age}`, profile.weight_lbs && `${profile.weight_lbs} lbs`, profile.fitness_goal && `goal: ${profile.fitness_goal}`, profile.target_weight_lbs && `target ${profile.target_weight_lbs} lbs`].filter(Boolean).join(', ')
    : 'not set'

  const onGymPage = page.startsWith('/gym')

  // Server truth wins; the client timer covers the gap where he's started the
  // session but hasn't logged a first set yet (nothing for the server to see).
  const midWorkout = !!liveSession || !!context?.inGymSession
  const gymSessionBlock = liveSession
    ? `\n${liveSessionBlock(liveSession)}`
    : context?.inGymSession
      ? `\n— IN A GYM SESSION RIGHT NOW: ${context.sessionMinutes ?? 0} min in, no sets logged yet`
      : ''

  const system = `You are the Atlas Orb — Luka's quick-capture assistant, living in a floating chat panel available on every page of his life-OS app. Your #1 job is turning what he says (often voice transcripts) into logged data fast. Your #2 job is tactical gym coaching (you replaced his old gym coach and kept its powers: recovery-aware training calls, exercise management, programs). Direct, honest, zero fluff, references his real numbers. You HAVE his live data in the context below (TODAY SO FAR, recovery, catalogs) — answer intake/status questions ("how much water have I had?") directly from it; never claim you lack access to his data. Be concise and decisive — this is quick capture, not a long conversation (his Mentor handles those).
${onGymPage ? '\nHe is ON THE GYM PAGE right now — lean tactical coach: give the call and the one-line reason. If recovery is low, dial back volume and say why; if high, green-light pushing.\n' : ''}${midWorkout ? '\nHe is MID-WORKOUT — reading this between sets with a bar waiting. Never tell him to go train, and never talk about today\'s session in the future tense; he is in it. Keep answers to a sentence or two, tactical, and reference the sets he has already logged. If he wants fire, give it to him for the sets that are left, not for showing up.\n' : ''}
FORMATTING — this renders in a narrow phone chat bubble. Plain conversational text. NEVER use markdown tables or horizontal rules (---). Keep **bold** to the occasional key number. When you list exercises, one per line like "Bench — 105×8–12". Short and scannable beats pretty.

UNITS: ${ctx.units}.

${ACTION_RULES}

When he asks for a multi-week PROGRAM or periodized plan ("build me a program", "8-week hypertrophy block"), use the generate_program tool. Infer goal / duration / days-per-week; defaults: hypertrophy, 8 weeks, his usual days/week. That tool opens a preview he reviews — keep your text brief ("Opening an 8-week hypertrophy build — tweak it in the preview").

— CURRENT PAGE: ${page}${gymSessionBlock}
— TODAY'S RECOVERY: ${recoveryLine}
— PROFILE: ${profileLine}

${ctx.catalogBlock}${profileBlock ? `\n\n${profileBlock}` : ''}`

  const tools = buildAssistantTools(ctx.units)

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')
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
        let replyText = ''
        let clarifyEmitted = false
        const actionKinds: string[] = []
        const actionNotes: string[] = []
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            toolAcc[event.index] = { name: event.content_block.name, json: '' }
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'text_delta') {
              if (event.delta.text) {
                replyText += event.delta.text
                send(controller, { t: 'text', v: event.delta.text })
              }
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
              if (resolved?.type === 'action') {
                actionKinds.push(resolved.action.kind)
                const d = describeAction(resolved.action, ctx.units)
                actionNotes.push(`[PROPOSED: ${d.title}${d.detail ? ` — ${d.detail}` : ''}]`)
                send(controller, { t: 'action', action: resolved.action })
              } else if (resolved?.type === 'clarify') {
                clarifyEmitted = true
                send(controller, { t: 'clarify', question: resolved.question, options: resolved.options })
              }
              delete toolAcc[event.index]
            }
          }
        }

        // Post-stream, pre-close: log the command + generate follow-up chips.
        // Neither may break the stream — each failure degrades to nothing.
        // Suggestions are skipped when a clarify was emitted (clarify chips own
        // the slot; the client wouldn't render suggestions anyway).
        const [, suggestions] = await Promise.all([
          db.from('orb_commands').insert({
            user_id: user.id,
            text: message.trim(),
            action_kinds: actionKinds,
            source: source ?? 'text',
            hour: typeof context?.hour === 'number' ? context.hour : null,
          }).then(({ error }) => { if (error) console.error('[assistant/chat] orb_commands insert:', error) }),
          clarifyEmitted
            ? Promise.resolve<string[]>([])
            : generateSuggestions(anthropic, { message: message.trim(), replyText, actionNotes, page, recoveryLine, context, liveSession })
                .catch(err => { console.error('[assistant/chat] suggestions:', err); return [] as string[] }),
        ])
        if (suggestions.length >= 2) send(controller, { t: 'suggestions', options: suggestions.slice(0, 3) })
        controller.close()
      } catch (err) {
        console.error('[assistant/chat] error:', err)
        const v = isAiLimitError(err) ? AI_LIMIT_MESSAGE : 'Atlas hit an error. Try again.'
        try { send(controller, { t: 'error', v }) } catch {}
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}

// ── Follow-up suggestion chips (ORB_SUGGESTIONS_SPEC.md §4) ───────────────────
// One cheap Haiku call after the main stream, forced tool call for structured
// output (same pattern as /api/gym/coach-step + subscriptions import).

const SUGGEST_MODEL = 'claude-haiku-4-5-20251001'

const SUGGEST_TOOL: Anthropic.Tool = {
  name: 'suggest',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 },
    },
    required: ['suggestions'],
  },
}

interface SuggestArgs {
  message: string
  replyText: string
  actionNotes: string[]
  page: string
  recoveryLine: string
  context?: ChatBody['context']
  liveSession?: LiveSession | null
}

async function generateSuggestions(anthropic: Anthropic, args: SuggestArgs): Promise<string[]> {
  const hour = typeof args.context?.hour === 'number' ? args.context.hour : null
  const hourLabel = hour == null ? 'unknown' : `${hour < 11 ? 'morning' : hour < 17 ? 'midday' : 'evening'} (hour ${hour})`
  const live = args.liveSession
  const gymLine = live
    ? ` · MID-WORKOUT: ${live.minutesIn} min in, ${live.setCount} sets done, last was ${live.lastSet.name}. Suggest next-set actions, not "start a workout".`
    : args.context?.inGymSession
      ? ` · IN A GYM SESSION, ${args.context.sessionMinutes ?? 0} min in`
      : ''

  const system = `You generate exactly 3 tap-to-send quick replies for Luka, the user of a fitness app. He just got
a response from Atlas (his logging assistant + gym coach) and these are the three most likely
things he'd say NEXT. They are sent verbatim as his message when tapped.

RULES
- Each suggestion is ≤ 8 words, ≤ 48 characters. First person, Luka's voice ("Log another set",
  "Why is my recovery low?") — never questions directed AT Luka.
- Every suggestion must be something Atlas can actually act on. Atlas can: log sets, supplements,
  body weight, water, caffeine, food, journal notes, check-in notes; adjust/add/remove/swap
  exercises; propose a workout; generate a program; answer questions from his gym history,
  recovery (Oura/WHOOP/Fitbit), and food/water/weight logs. Atlas CANNOT: show charts, set reminders,
  control other apps, or answer general trivia.
- Ground them in the conversation. Aim for a spread: (1) continue the current task, (2) a related
  next action, (3) an insight question about his data. Collapse the spread when the context
  demands it (mid-set logging → mostly actions).
- Never suggest something already logged, executed, or dismissed in this conversation ([PROPOSED:
  …] notes show what Atlas just put on confirm cards — don't re-suggest those).
- Use his real context below. In a gym session → tactical and short. Morning → check-in, weigh-in,
  supplements. Evening → reflection, dinner, evening supplements.
- If the assistant asked a question, suggestions are 3 plausible ANSWERS to it.

CONTEXT
— PAGE: ${args.page}
— NOW: ${hourLabel}${gymLine}
— TODAY'S RECOVERY: ${args.recoveryLine}`

  const reply = args.replyText.length > 600 ? `${args.replyText.slice(0, 600)}…` : args.replyText
  const notes = args.actionNotes.length ? `\n${args.actionNotes.join(' ')}` : ''
  const res = await anthropic.messages.create({
    model: SUGGEST_MODEL,
    max_tokens: 200,
    system,
    tools: [SUGGEST_TOOL],
    tool_choice: { type: 'tool', name: 'suggest' },
    messages: [{
      role: 'user',
      content: `<exchange>\nLUKA: ${args.message}\nATLAS: ${reply}${notes}\n</exchange>\nGenerate the 3 quick replies.`,
    }],
  })

  const block = res.content.find(b => b.type === 'tool_use')
  const raw = block?.type === 'tool_use' ? (block.input as { suggestions?: unknown }).suggestions : null
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of raw) {
    if (typeof s !== 'string') continue
    const t = s.trim()
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}
