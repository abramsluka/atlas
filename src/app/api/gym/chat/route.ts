import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { subDays } from 'date-fns'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import type { OuraData, WhoopData } from '@/features/health/types'
import type { GymConfig, GymExercise } from '@/features/gym/types'
import type { GymCoachAction, CoachStreamEvent } from '@/features/gym/coachActions'
import type { ProgramGoal, ProgramStructure } from '@/features/gym/programTypes'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'

interface ChatBody {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  currentExId?: string | null
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { message, history = [], currentExId = null } = (await req.json()) as ChatBody
  if (!message?.trim()) return new Response('message is required', { status: 400 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)
  const thirtyDaysAgoIso = subDays(new Date(), 30).toISOString()

  const [configRes, exercisesRes, logsRes, wearableRes, profileRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', user.id).order('order_index').order('created_at'),
    db.from('gym_logs').select('exercise_id, weight, reps, logged_at').eq('user_id', user.id).gte('logged_at', thirtyDaysAgoIso).order('logged_at', { ascending: false }),
    db.from('wearable_data').select('data, provider').eq('user_id', user.id).eq('date', today).in('provider', ['oura', 'whoop']),
    db.from('health_profile').select('age, weight_lbs, fitness_goal, target_weight_lbs').eq('user_id', user.id).maybeSingle(),
  ])

  const config = (configRes.data as GymConfig | null)
  const exercises = (exercisesRes.data as GymExercise[] | null) ?? []
  const logs = (logsRes.data as Array<{ exercise_id: string; weight: number; reps: number; logged_at: string }>) ?? []

  // ── Resolution maps (used by buildAction) ──
  const exerciseById = new Map(exercises.map(e => [e.id, e]))
  const dayName = (id: string) => config?.days.find(d => d.id === id)?.name ?? id
  const units = config?.units ?? 'lbs'

  // ── Per-exercise last + best set from the last 30 days ──
  interface ExStat { last?: { weight: number; reps: number; at: string }; best?: { weight: number; reps: number } }
  const stats = new Map<string, ExStat>()
  for (const log of logs) {
    const s = stats.get(log.exercise_id) ?? {}
    if (!s.last) s.last = { weight: log.weight, reps: log.reps, at: log.logged_at } // logs are desc → first seen = most recent
    if (!s.best || log.weight > s.best.weight || (log.weight === s.best.weight && log.reps > s.best.reps)) {
      s.best = { weight: log.weight, reps: log.reps }
    }
    stats.set(log.exercise_id, s)
  }

  const relDays = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`
  }

  // ── Exercise catalog for the prompt ──
  const catalog = exercises.map(e => {
    const s = stats.get(e.id)
    const days = e.day_ids.map(dayName).join('/') || '—'
    const last = s?.last ? `last ${s.last.weight}×${s.last.reps} (${relDays(s.last.at)})` : 'no recent logs'
    const best = s?.best ? `, best ${s.best.weight}×${s.best.reps}` : ''
    const bw = e.bodyweight ? ', bodyweight' : ''
    return `[${e.id}] ${e.name} — days: ${days}, range ${e.rep_min}-${e.rep_max} reps, step +${e.step}${bw} — ${last}${best}`
  }).join('\n')

  const dayList = (config?.days ?? []).map(d => `[${d.id}] ${d.name}`).join('\n') || '(none)'
  const gymList = (config?.gyms ?? []).map(g => `[${g.id}] ${g.name}`).join('\n') || '(none)'

  // ── Recovery today ──
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

  // ── Current focus exercise ──
  let focusLine = 'none — user is on the gym page but not logging a specific exercise right now.'
  if (currentExId && exerciseById.has(currentExId)) {
    const e = exerciseById.get(currentExId)!
    const s = stats.get(e.id)
    focusLine = `${e.name} (id ${e.id}) — range ${e.rep_min}-${e.rep_max}, ${s?.last ? `last ${s.last.weight}×${s.last.reps} (${relDays(s.last.at)})` : 'no recent logs'}.`
  }

  const system = `You are Atlas Gym Coach — Luka's in-the-moment strength coach, living in a chat panel on his gym page. You share the same DNA as his Mentor (direct, honest, in his corner, references his real numbers, zero fluff) but you are TACTICAL: this is the gym, mid-session. Be concise and decisive. Give the call and the one-line reason. Don't ask reflective "how does that feel" questions — that's Mentor's job. One short follow-up max, only if you genuinely need it to act.

You ARE recovery-aware: if recovery/readiness is low, dial back volume or intensity and say why. If it's high, green-light pushing.

FORMATTING — this renders in a narrow phone chat bubble. Write plain conversational text. NEVER use markdown tables or horizontal rules (---). Keep **bold** to the occasional key number or the verdict, not whole sentences. When you list exercises, put each on its own line like "Bench — 105×8–12" (not a table). Short and scannable beats pretty.

UNITS: ${units}.

YOU CAN TAKE ACTIONS via tools. When Luka wants to log a set, change an exercise, or build a workout, CALL THE MATCHING TOOL to PROPOSE it. The proposal becomes a confirm card he taps — so do NOT say "done" or "logged" yourself; say what you're proposing ("Logging 135×8 — confirm below?"). Reference exercises by their [id] from the catalog. Only propose actions he actually asked for or clearly implied; don't surprise him with changes.

When he asks for a multi-week PROGRAM or periodized plan ("build me a program", "I want an 8-week hypertrophy block"), use the generate_program tool. Infer goal / duration / days-per-week from what he said; if unspecified, default to hypertrophy, 8 weeks, and his usual days/week. That tool opens a preview he reviews and saves — it does NOT generate inline, so keep your text brief ("Opening an 8-week hypertrophy build — tweak it in the preview").

— TODAY'S RECOVERY: ${recoveryLine}
— PROFILE: ${profileLine}
— CURRENTLY VIEWING: ${focusLine}

— YOUR DAYS (splits):
${dayList}

— GYMS:
${gymList}

— EXERCISE CATALOG (use these [id]s):
${catalog || '(no exercises yet)'}`

  const tools: Anthropic.Tool[] = [
    {
      name: 'log_set',
      description: 'Propose logging a completed set for an exercise. Use the exercise [id] from the catalog.',
      input_schema: {
        type: 'object',
        properties: {
          exercise_id: { type: 'string', description: 'Exercise [id] from the catalog' },
          weight: { type: 'number', description: `Weight in ${units}` },
          reps: { type: 'number' },
        },
        required: ['exercise_id', 'weight', 'reps'],
      },
    },
    {
      name: 'adjust_exercise',
      description: 'Propose changing the rep target range and/or progression step of an existing exercise.',
      input_schema: {
        type: 'object',
        properties: {
          exercise_id: { type: 'string' },
          rep_min: { type: 'number' },
          rep_max: { type: 'number' },
          step: { type: 'number', description: 'Weight increment when progressing' },
        },
        required: ['exercise_id'],
      },
    },
    {
      name: 'add_exercise',
      description: 'Propose adding a brand-new exercise to one of the existing days.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          day_id: { type: 'string', description: 'Day [id] to add it to' },
          gym_id: { type: 'string', description: "Gym [id], or 'both'. Defaults to 'both'." },
          rep_min: { type: 'number' },
          rep_max: { type: 'number' },
          step: { type: 'number' },
          bodyweight: { type: 'boolean' },
        },
        required: ['name', 'day_id'],
      },
    },
    {
      name: 'remove_exercise',
      description: 'Propose removing an exercise from the catalog entirely.',
      input_schema: {
        type: 'object',
        properties: { exercise_id: { type: 'string' } },
        required: ['exercise_id'],
      },
    },
    {
      name: 'swap_exercise',
      description: 'Propose swapping out one exercise for a new one (e.g. an exercise that hurts). The replacement inherits the same day(s) and gym unless overridden.',
      input_schema: {
        type: 'object',
        properties: {
          out_exercise_id: { type: 'string', description: 'Exercise [id] being replaced' },
          in_name: { type: 'string', description: 'Name of the replacement exercise' },
          gym_id: { type: 'string' },
          rep_min: { type: 'number' },
          rep_max: { type: 'number' },
          step: { type: 'number' },
          bodyweight: { type: 'boolean' },
        },
        required: ['out_exercise_id', 'in_name'],
      },
    },
    {
      name: 'propose_workout',
      description: 'Propose a whole workout (a set of exercises) to place into the user\'s days. Set existing_day_id to add to an existing day, or leave it null to create a new day named day_name.',
      input_schema: {
        type: 'object',
        properties: {
          day_name: { type: 'string', description: 'Label for the workout / new day, e.g. "Full Body A"' },
          existing_day_id: { type: 'string', description: 'Day [id] to append to, or omit to create a new day' },
          gym_id: { type: 'string' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                rep_min: { type: 'number' },
                rep_max: { type: 'number' },
                step: { type: 'number' },
                bodyweight: { type: 'boolean' },
              },
              required: ['name', 'rep_min', 'rep_max'],
            },
          },
        },
        required: ['day_name', 'exercises'],
      },
    },
    {
      name: 'generate_program',
      description: 'Open the program generator for a multi-week periodized plan. Use when he asks for a program/block, not a single workout.',
      input_schema: {
        type: 'object',
        properties: {
          goal: { type: 'string', enum: ['strength', 'hypertrophy', 'recomp'] },
          duration_weeks: { type: 'integer', enum: [4, 6, 8] },
          days_per_week: { type: 'integer', enum: [3, 4, 5] },
          structure: { type: 'string', enum: ['overlay', 'standalone'], description: "'overlay' layers onto his existing days; 'standalone' is its own plan. Default overlay." },
        },
        required: ['goal', 'duration_weeks', 'days_per_week'],
      },
    },
  ]

  // ── Turn a Claude tool call into a GymCoachAction proposal ──
  const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)
  function buildAction(name: string, input: Record<string, unknown>): GymCoachAction | null {
    switch (name) {
      case 'log_set': {
        const ex = exerciseById.get(String(input.exercise_id))
        const weight = num(input.weight), reps = num(input.reps)
        if (!ex || weight == null || reps == null) return null
        return { kind: 'log_set', exercise_id: ex.id, exercise_name: ex.name, weight, reps }
      }
      case 'adjust_exercise': {
        const ex = exerciseById.get(String(input.exercise_id))
        if (!ex) return null
        return { kind: 'adjust_exercise', exercise_id: ex.id, exercise_name: ex.name, rep_min: num(input.rep_min), rep_max: num(input.rep_max), step: num(input.step) }
      }
      case 'add_exercise': {
        const dayId = String(input.day_id)
        if (!config?.days.some(d => d.id === dayId)) return null
        return {
          kind: 'add_exercise', name: String(input.name || '').trim(),
          gym_id: String(input.gym_id || 'both'), day_ids: [dayId], day_label: dayName(dayId),
          rep_min: num(input.rep_min) ?? 8, rep_max: num(input.rep_max) ?? 12, step: num(input.step) ?? 5,
          bodyweight: !!input.bodyweight,
        }
      }
      case 'remove_exercise': {
        const ex = exerciseById.get(String(input.exercise_id))
        if (!ex) return null
        return { kind: 'remove_exercise', exercise_id: ex.id, exercise_name: ex.name }
      }
      case 'swap_exercise': {
        const out = exerciseById.get(String(input.out_exercise_id))
        if (!out || !String(input.in_name || '').trim()) return null
        return {
          kind: 'swap_exercise', out_exercise_id: out.id, out_name: out.name, in_name: String(input.in_name).trim(),
          gym_id: String(input.gym_id || out.gym_id || 'both'), day_ids: out.day_ids, day_label: out.day_ids.map(dayName).join('/') || '—',
          rep_min: num(input.rep_min) ?? out.rep_min, rep_max: num(input.rep_max) ?? out.rep_max, step: num(input.step) ?? out.step,
          bodyweight: input.bodyweight != null ? !!input.bodyweight : out.bodyweight,
        }
      }
      case 'propose_workout': {
        const raw = Array.isArray(input.exercises) ? input.exercises as Array<Record<string, unknown>> : []
        const exs = raw.map(e => ({
          name: String(e.name || '').trim(),
          rep_min: num(e.rep_min) ?? 8, rep_max: num(e.rep_max) ?? 12, step: num(e.step) ?? 5,
          bodyweight: !!e.bodyweight,
        })).filter(e => e.name)
        if (!exs.length) return null
        const existing = input.existing_day_id ? String(input.existing_day_id) : null
        const validExisting = existing && config?.days.some(d => d.id === existing) ? existing : null
        return {
          kind: 'propose_workout',
          day_name: String(input.day_name || (validExisting ? dayName(validExisting) : 'New Workout')),
          existing_day_id: validExisting, gym_id: String(input.gym_id || 'both'), exercises: exs,
        }
      }
      case 'generate_program': {
        const goal: ProgramGoal = (['strength', 'hypertrophy', 'recomp'] as const).includes(input.goal as ProgramGoal)
          ? (input.goal as ProgramGoal) : 'hypertrophy'
        const duration_weeks = [4, 6, 8].includes(Number(input.duration_weeks)) ? Number(input.duration_weeks) : 8
        const days_per_week = [3, 4, 5].includes(Number(input.days_per_week)) ? Number(input.days_per_week) : 4
        const structure: ProgramStructure = input.structure === 'standalone' ? 'standalone' : 'overlay'
        return { kind: 'generate_program', goal, duration_weeks, days_per_week, structure }
      }
      default:
        return null
    }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-12).map(m => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: message.trim() },
  ]

  const encoder = new TextEncoder()
  const send = (c: ReadableStreamDefaultController, e: CoachStreamEvent) => c.enqueue(encoder.encode(JSON.stringify(e) + '\n'))

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
              const action = buildAction(acc.name, input)
              if (action) send(controller, { t: 'action', action })
              delete toolAcc[event.index]
            }
          }
        }
        controller.close()
      } catch (err) {
        console.error('[gym/chat] error:', err)
        try { send(controller, { t: 'error', v: 'Coach hit an error. Try again.' }) } catch {}
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  })
}
