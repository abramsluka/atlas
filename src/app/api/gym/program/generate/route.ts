import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'
import { subDays } from 'date-fns'
import { getUserTimezone } from '@/lib/getUserTimezone'
import type { OuraData } from '@/features/health/types'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'
import type { GymConfig, GymExercise } from '@/features/gym/types'
import type {
  GeneratedProgram, GenerateProgramRequest, ProgramGoal, ProgramStructure, ProgramSession, ProgramPhase,
} from '@/features/gym/programTypes'

export const runtime = 'nodejs'
export const maxDuration = 60

const MODEL = 'claude-sonnet-4-6'
const GOALS: ProgramGoal[] = ['strength', 'hypertrophy', 'recomp']
const PHASES: ProgramPhase[] = ['accumulation', 'deload', 'intensification', 'peak']

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as Partial<GenerateProgramRequest>
  const goal: ProgramGoal = GOALS.includes(body.goal as ProgramGoal) ? (body.goal as ProgramGoal) : 'hypertrophy'
  const duration_weeks = [4, 6, 8].includes(Number(body.duration_weeks)) ? Number(body.duration_weeks) : 8
  const days_per_week = [3, 4, 5].includes(Number(body.days_per_week)) ? Number(body.days_per_week) : 4
  const structure: ProgramStructure = body.structure === 'standalone' ? 'standalone' : 'overlay'

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const ninetyAgo = subDays(new Date(), 90).toISOString()
  const fourteenAgo = subDays(new Date(), 14).toISOString()
  const fourteenAgoDate = subDays(new Date(), 14).toISOString().slice(0, 10)

  const [configRes, exercisesRes, logsRes, wearableRes, profileRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', user.id).order('order_index'),
    db.from('gym_logs').select('exercise_id, weight, reps').eq('user_id', user.id).gte('logged_at', ninetyAgo),
    db.from('wearable_data').select('data, provider, date').eq('user_id', user.id).gte('date', fourteenAgoDate).eq('provider', 'oura'),
    db.from('health_profile').select('age, weight_lbs, fitness_goal, target_weight_lbs').eq('user_id', user.id).maybeSingle(),
  ])

  const config = configRes.data as GymConfig | null
  const exercises = (exercisesRes.data as GymExercise[] | null) ?? []
  const logs = (logsRes.data as Array<{ exercise_id: string; weight: number; reps: number }>) ?? []

  if (!exercises.length) {
    return NextResponse.json({ error: 'Add some exercises first — the coach builds programs from your catalog.' }, { status: 400 })
  }

  // ── Best set + est 1RM (Epley) per exercise ──
  const best = new Map<string, { weight: number; reps: number }>()
  for (const l of logs) {
    const b = best.get(l.exercise_id)
    if (!b || l.weight > b.weight || (l.weight === b.weight && l.reps > b.reps)) best.set(l.exercise_id, { weight: l.weight, reps: l.reps })
  }
  const est1RM = (w: number, r: number) => Math.round(w * (1 + r / 30))

  const dayName = (id: string) => config?.days.find(d => d.id === id)?.name ?? id
  const catalog = exercises.map(e => {
    const b = best.get(e.id)
    const pr = b ? `best ${b.weight}×${b.reps} (est 1RM ${est1RM(b.weight, b.reps)})` : 'no logs yet'
    const days = e.day_ids.map(dayName).join('/') || '—'
    return `[${e.id}] ${e.name} — days: ${days}${e.bodyweight ? ', bodyweight' : ''} — ${pr}`
  }).join('\n')

  const dayList = (config?.days ?? []).map(d => `[${d.id}] ${d.name}`).join('\n') || '(none)'

  // ── Recovery baseline (avg over last 14d) ──
  const readinessVals: number[] = []
  for (const row of (wearableRes.data ?? []) as Array<{ provider: string; data: Record<string, unknown> }>) {
    if (row.provider === 'oura') {
      const o = row.data as OuraData
      if (o.readiness?.score != null) readinessVals.push(o.readiness.score)
    }
  }
  const avgReadiness = readinessVals.length ? Math.round(readinessVals.reduce((a, b) => a + b, 0) / readinessVals.length) : null
  const recoveryLine = avgReadiness != null
    ? `avg recovery/readiness ${avgReadiness} over last 14 days (${avgReadiness >= 75 ? 'strong' : avgReadiness >= 60 ? 'moderate' : 'low'} baseline)`
    : 'no wearable recovery data'

  const profile = profileRes.data as { age: number | null; weight_lbs: number | null; fitness_goal: string | null } | null
  const profileLine = profile
    ? [profile.age && `age ${profile.age}`, profile.weight_lbs && `${profile.weight_lbs} lbs`, profile.fitness_goal && `goal: ${profile.fitness_goal}`].filter(Boolean).join(', ')
    : 'not set'

  const profileBlock = await getProfileBlock(db, user.id, 'gym')

  const structureGuide = structure === 'overlay'
    ? `STRUCTURE = OVERLAY: map each of the ${days_per_week} sessions onto the user's EXISTING days below — set day_id to the day's [id] and label to its name. Use that day's existing exercises (their [id]s) as the movements. You may add ONE new movement per session if the goal genuinely needs it (exercise_id=null, is_new=true, but still assign it the session's day_id is implied by the session).`
    : `STRUCTURE = STANDALONE: invent ${days_per_week} session labels appropriate to the goal and days/week (e.g. Push/Pull/Legs, Upper/Lower, Full Body A/B). Set day_id=null. Pull movements from the catalog by [id] where they fit, and add new movements (exercise_id=null, is_new=true) freely where the program needs them.`

  const system = `You are an elite strength coach generating a periodized training program. Output ONLY via the emit_program tool.

HARD RULES:
- This program is the PERIODIZATION layer. Do NOT prescribe weights — the user's progressive-overload engine owns the bar weight. You prescribe SETS, REP RANGES, RPE, and the weekly PHASE only.
- Build exactly ${duration_weeks} weeks and exactly ${days_per_week} sessions per week.
- Periodize sensibly for a ${goal} goal over ${duration_weeks} weeks: early weeks accumulation (higher volume), a deload week placed appropriately (≈ every 4th week / mid-block), later weeks intensification then a peak/test week at the end. Use phase values from: ${PHASES.join(', ')}.
- The "weeks" array defines, per week, the session-wide scheme (phase, working sets per exercise, rep range, RPE target). The "sessions" array defines the movements for each session ONCE (they repeat every week; only the weekly scheme changes). Keep it compact.
- ${goal === 'strength' ? 'Strength: lower reps (3–6 working range), higher RPE in intensification/peak.' : goal === 'hypertrophy' ? 'Hypertrophy: 8–15 rep range, volume-driven, RPE 7–9.' : 'Recomp: 6–12 reps, balanced volume and intensity.'}
- Deload weeks: cut working sets ~40% and pull RPE back to ~6.

${structureGuide}

CONTEXT
— Goal: ${goal} | Duration: ${duration_weeks} weeks | Days/week: ${days_per_week}
— Recovery: ${recoveryLine}
— Profile: ${profileLine}

— USER'S DAYS:
${dayList}

— EXERCISE CATALOG (use these [id]s as exercise_id):
${catalog}${profileBlock ? `\n\n${profileBlock}` : ''}`

  const tools: Anthropic.Tool[] = [{
    name: 'emit_program',
    description: 'Emit the full periodized program.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "8-Week Hypertrophy Block"' },
        notes: { type: 'string', description: 'One or two sentences on the block intent.' },
        weeks: {
          type: 'array',
          description: `Exactly ${duration_weeks} entries, one per week.`,
          items: {
            type: 'object',
            properties: {
              week_number: { type: 'integer' },
              phase: { type: 'string', enum: PHASES },
              sets: { type: 'integer', description: 'Working sets per exercise this week' },
              rep_min: { type: 'integer' },
              rep_max: { type: 'integer' },
              rpe: { type: 'number', description: 'Target RPE this week (1-10)' },
              note: { type: 'string' },
            },
            required: ['week_number', 'phase', 'sets', 'rep_min', 'rep_max'],
          },
        },
        sessions: {
          type: 'array',
          description: `Exactly ${days_per_week} session templates (the movements; they repeat each week).`,
          items: {
            type: 'object',
            properties: {
              session_number: { type: 'integer' },
              label: { type: 'string' },
              day_id: { type: ['string', 'null'], description: 'Overlay: the day [id]. Standalone: null.' },
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    exercise_id: { type: ['string', 'null'], description: 'Existing exercise [id], or null for a new movement' },
                    name: { type: 'string' },
                    is_new: { type: 'boolean' },
                    base_sets: { type: 'integer' },
                    rep_min: { type: 'integer' },
                    rep_max: { type: 'integer' },
                  },
                  required: ['name', 'is_new'],
                },
              },
            },
            required: ['session_number', 'label', 'exercises'],
          },
        },
      },
      required: ['name', 'weeks', 'sessions'],
    },
  }]

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')
  let parsed: {
    name?: string; notes?: string
    weeks?: Array<{ week_number: number; phase: string; sets?: number; rep_min?: number; rep_max?: number; rpe?: number }>
    sessions?: Array<{ session_number: number; label: string; day_id?: string | null; exercises?: Array<{ exercise_id?: string | null; name: string; is_new?: boolean; base_sets?: number; rep_min?: number; rep_max?: number }> }>
  } = {}

  try {
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 4000, system,
      tools, tool_choice: { type: 'tool', name: 'emit_program' },
      messages: [{ role: 'user', content: `Generate my ${duration_weeks}-week ${goal} program, ${days_per_week} days/week.` }],
    })
    const toolUse = msg.content.find(c => c.type === 'tool_use')
    if (toolUse && toolUse.type === 'tool_use') parsed = toolUse.input as typeof parsed
  } catch (err) {
    console.error('[program/generate] error:', err)
    if (isAiLimitError(err)) return aiLimitResponse()
    return NextResponse.json({ error: 'Generation failed. Try again.' }, { status: 500 })
  }

  const weeks = (parsed.weeks ?? []).slice(0, duration_weeks)
  const templates = (parsed.sessions ?? []).slice(0, days_per_week)
  if (!weeks.length || !templates.length) {
    return NextResponse.json({ error: 'Generation came back empty. Try again.' }, { status: 502 })
  }

  const validDayIds = new Set((config?.days ?? []).map(d => d.id))

  // Expand week schemes × session templates into full sessions.
  const sessions: ProgramSession[] = []
  for (const w of weeks) {
    const phase = (PHASES.includes(w.phase as ProgramPhase) ? w.phase : 'accumulation') as ProgramPhase
    for (const t of templates) {
      const dayId = structure === 'overlay' && t.day_id && validDayIds.has(t.day_id) ? t.day_id : null
      sessions.push({
        week_number: w.week_number,
        session_number: t.session_number,
        label: t.label,
        day_id: dayId,
        phase,
        exercises: (t.exercises ?? []).filter(e => e.name?.trim()).map(e => ({
          exercise_id: e.exercise_id && exercises.some(x => x.id === e.exercise_id) ? e.exercise_id : null,
          name: e.name.trim(),
          is_new: !!e.is_new || !(e.exercise_id && exercises.some(x => x.id === e.exercise_id)),
          sets: w.sets ?? e.base_sets ?? 3,
          rep_min: w.rep_min ?? e.rep_min ?? 8,
          rep_max: w.rep_max ?? e.rep_max ?? 12,
          rpe: w.rpe ?? null,
          notes: null,
        })),
      })
    }
  }

  const program: GeneratedProgram = {
    name: parsed.name?.trim() || `${duration_weeks}-Week ${goal[0].toUpperCase()}${goal.slice(1)} Block`,
    goal, duration_weeks, days_per_week, structure,
    notes: parsed.notes?.trim() || null,
    sessions,
  }

  return NextResponse.json(program)
}
