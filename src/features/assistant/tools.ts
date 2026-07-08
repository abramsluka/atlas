// Server-only: shared between /api/assistant/chat and /api/mentor/chat.
// Loads the context both routes need, declares the Anthropic tool set, and
// resolves raw tool calls into validated AssistantAction proposals.

import Anthropic from '@anthropic-ai/sdk'
import { subDays } from 'date-fns'
import type { createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, daysAgoLocal } from '@/lib/date'
import { formatInTimeZone } from 'date-fns-tz'
import type { GymConfig, GymExercise } from '@/features/gym/types'
import type { TimeSlot } from '@/features/health/types'
import type { ProgramGoal, ProgramStructure } from '@/features/gym/programTypes'
import { PORTION_STYLE_RULES } from '@/features/food/portionStyle'
import type { AssistantAction } from './actions'

type DB = ReturnType<typeof createServiceClient>

const TIME_SLOTS: TimeSlot[] = ['morning', 'lunch', 'evening', 'anytime']

export interface AssistantContext {
  tz: string
  today: string
  units: string
  config: GymConfig | null
  exercises: GymExercise[]
  exerciseById: Map<string, GymExercise>
  dayName: (id: string) => string
  supplements: Array<{ id: string; name: string; times: TimeSlot[] }>
  supplementById: Map<string, { id: string; name: string; times: TimeSlot[] }>
  loggedSlotsToday: Map<string, Set<string>>   // supplement_id → time_slots logged today
  bottleOz: number         // his configured bottle size, for "drank a bottle"
  glassOz: number          // his configured glass size
  habits: Array<{ id: string; name: string; kind: string }>
  habitById: Map<string, { id: string; name: string; kind: string }>
  habitDoneToday: Set<string>
  catalogBlock: string     // formatted context for the system prompt
}

export async function loadAssistantContext(db: DB, userId: string): Promise<AssistantContext> {
  const tz = await getUserTimezone(userId)
  const today = toLocalDate(tz)
  const thirtyDaysAgoIso = subDays(new Date(), 30).toISOString()
  const sevenDaysAgo = daysAgoLocal(7, tz)

  const [configRes, exercisesRes, logsRes, suppsRes, doseRes, weightRes, waterRes, caffeineRes, foodRes, checkinRes, containerRes, habitsRes, habitDoneRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', userId).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', userId).order('order_index').order('created_at'),
    db.from('gym_logs').select('exercise_id, weight, reps, logged_at').eq('user_id', userId).gte('logged_at', thirtyDaysAgoIso).order('logged_at', { ascending: false }),
    db.from('supplements').select('id, name, times').eq('user_id', userId).eq('active', true).order('order_index'),
    db.from('supplement_logs').select('supplement_id, time_slot').eq('user_id', userId).eq('date', today),
    db.from('body_weights').select('date_key, weight').eq('user_id', userId).order('date_key', { ascending: false }).limit(1).maybeSingle(),
    db.from('water_logs').select('date, amount_oz').eq('user_id', userId).gte('date', sevenDaysAgo),
    db.from('caffeine_logs').select('source, amount_mg').eq('user_id', userId).eq('date', today),
    db.from('food_logs').select('date, item_name, calories, protein_g, carbs_g').eq('user_id', userId).gte('date', sevenDaysAgo).order('date', { ascending: false }).limit(40),
    db.from('daily_checkins').select('morning_planned_training, morning_intent, evening_actual_training, evening_reflection').eq('user_id', userId).eq('date', today).maybeSingle(),
    db.from('health_profile').select('bottle_ml, glass_ml').eq('user_id', userId).maybeSingle(),
    db.from('habits').select('id, name, emoji, kind, order_index').eq('user_id', userId).eq('active', true).order('order_index'),
    db.from('habit_completions').select('habit_id').eq('user_id', userId).eq('date', today).eq('completed', true),
  ])

  const config = configRes.data as GymConfig | null
  const exercises = (exercisesRes.data as GymExercise[] | null) ?? []
  const logs = (logsRes.data as Array<{ exercise_id: string; weight: number; reps: number; logged_at: string }>) ?? []
  const supplements = (suppsRes.data as Array<{ id: string; name: string; times: TimeSlot[] | null }> | null ?? [])
    .map(s => ({ ...s, times: s.times ?? [] }))

  const exerciseById = new Map(exercises.map(e => [e.id, e]))
  const supplementById = new Map(supplements.map(s => [s.id, s]))
  const dayName = (id: string) => config?.days.find(d => d.id === id)?.name ?? id
  const units = config?.units ?? 'lbs'

  const loggedSlotsToday = new Map<string, Set<string>>()
  for (const row of (doseRes.data ?? []) as Array<{ supplement_id: string; time_slot: string }>) {
    const set = loggedSlotsToday.get(row.supplement_id) ?? new Set<string>()
    set.add(row.time_slot)
    loggedSlotsToday.set(row.supplement_id, set)
  }

  // ── Per-exercise last + best set (last 30 days; logs are desc) ──
  interface ExStat { last?: { weight: number; reps: number; at: string }; best?: { weight: number; reps: number } }
  const stats = new Map<string, ExStat>()
  for (const log of logs) {
    const s = stats.get(log.exercise_id) ?? {}
    if (!s.last) s.last = { weight: log.weight, reps: log.reps, at: log.logged_at }
    if (!s.best || log.weight > s.best.weight || (log.weight === s.best.weight && log.reps > s.best.reps)) {
      s.best = { weight: log.weight, reps: log.reps }
    }
    stats.set(log.exercise_id, s)
  }
  const relDays = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`
  }

  const exerciseCatalog = exercises.map(e => {
    const s = stats.get(e.id)
    const days = e.day_ids.map(dayName).join('/') || '—'
    const last = s?.last ? `last ${s.last.weight}×${s.last.reps} (${relDays(s.last.at)})` : 'no recent logs'
    const best = s?.best ? `, best ${s.best.weight}×${s.best.reps}` : ''
    const bw = e.bodyweight ? ', bodyweight' : ''
    return `[${e.id}] ${e.name} — days: ${days}, range ${e.rep_min}-${e.rep_max} reps, step +${e.step}${bw} — ${last}${best}`
  }).join('\n')

  const supplementCatalog = supplements.map(s => {
    const logged = [...(loggedSlotsToday.get(s.id) ?? [])]
    const slots = s.times.length ? s.times.join('/') : 'anytime'
    return `[${s.id}] ${s.name} — slots: ${slots}${logged.length ? ` — ALREADY LOGGED TODAY: ${logged.join(', ')}` : ''}`
  }).join('\n')

  const habits = ((habitsRes.data as Array<{ id: string; name: string; emoji: string | null; kind: string }> | null) ?? [])
    .map(h => ({ id: h.id, name: h.name, kind: h.kind }))
  const habitById = new Map(habits.map(h => [h.id, h]))
  const habitDoneToday = new Set<string>(((habitDoneRes.data as Array<{ habit_id: string }> | null) ?? []).map(r => r.habit_id))
  const habitCatalog = habits
    .map(h => `[${h.id}] ${h.name}${h.kind === 'auto' ? ' (auto — derives itself)' : ''}${habitDoneToday.has(h.id) ? ' — ALREADY DONE TODAY' : ''}`)
    .join('\n')

  const dayList = (config?.days ?? []).map(d => `[${d.id}] ${d.name}`).join('\n') || '(none)'
  const gymList = (config?.gyms ?? []).map(g => `[${g.id}] ${g.name}`).join('\n') || '(none)'
  const lastWeight = weightRes.data as { date_key: string; weight: number } | null
  const localTime = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date())

  // ── Today so far: water / caffeine / food / training / check-in ──
  const r1 = (n: number) => Math.round(n * 10) / 10
  const OZ_PER_ML = 1 / 29.5735
  const containers = containerRes.data as { bottle_ml: number | null; glass_ml: number | null } | null
  const bottleOz = r1((containers?.bottle_ml ?? 500) * OZ_PER_ML)
  const glassOz = r1((containers?.glass_ml ?? 250) * OZ_PER_ML)

  const waterRows = (waterRes.data ?? []) as Array<{ date: string; amount_oz: number | null }>
  const waterTodayOz = r1(waterRows.filter(w => w.date === today).reduce((t, w) => t + (w.amount_oz ?? 0), 0))
  const pastWater = waterRows.filter(w => w.date !== today)
  const pastWaterDays = new Set(pastWater.map(w => w.date)).size
  const waterAvg = pastWaterDays ? Math.round(pastWater.reduce((t, w) => t + (w.amount_oz ?? 0), 0) / pastWaterDays) : null

  const caffeineRows = (caffeineRes.data ?? []) as Array<{ source: string; amount_mg: number | null }>
  const caffeineTodayMg = Math.round(caffeineRows.reduce((t, c) => t + (c.amount_mg ?? 0), 0))
  const caffeineSources = caffeineRows.map(c => c.source).join(', ')

  const foodRows = (foodRes.data ?? []) as Array<{ date: string; item_name: string; calories: number | null; protein_g: number | null; carbs_g: number | null }>
  const foodToday = foodRows.filter(f => f.date === today)
  const calToday = Math.round(foodToday.reduce((t, f) => t + (f.calories ?? 0), 0))
  const proteinToday = Math.round(foodToday.reduce((t, f) => t + (f.protein_g ?? 0), 0))
  const carbsToday = Math.round(foodToday.reduce((t, f) => t + (f.carbs_g ?? 0), 0))
  const foodItems = foodToday.map(f => f.item_name).join(', ')

  const setsToday = logs.filter(l => formatInTimeZone(new Date(l.logged_at), tz, 'yyyy-MM-dd') === today)
  const setsTodayByEx = new Map<string, number>()
  for (const s of setsToday) setsTodayByEx.set(s.exercise_id, (setsTodayByEx.get(s.exercise_id) ?? 0) + 1)
  const trainingToday = setsToday.length
    ? `${setsToday.length} set${setsToday.length === 1 ? '' : 's'} — ${[...setsTodayByEx.entries()].map(([id, n]) => `${exerciseById.get(id)?.name ?? 'unknown'}×${n}`).join(', ')}`
    : 'nothing logged yet'

  const checkin = checkinRes.data as { morning_planned_training: boolean | null; morning_intent: string | null; evening_actual_training: boolean | null; evening_reflection: string | null } | null
  const checkinLine = checkin
    ? `morning ${checkin.morning_planned_training == null ? 'not done' : checkin.morning_planned_training ? 'training planned' : 'rest day'}${checkin.morning_intent ? ` ("${checkin.morning_intent}")` : ''} · evening ${checkin.evening_actual_training == null ? 'not done' : checkin.evening_actual_training ? 'trained' : "didn't train"}`
    : 'not done yet'

  const todayBlock = `— TODAY SO FAR (answer intake/progress questions from this — it is his live data):
  water: ${waterTodayOz} oz${bottleOz ? ` (≈${r1(waterTodayOz / bottleOz)} bottles)` : ''}${waterAvg != null ? ` — 7d avg ${waterAvg} oz/day` : ''}
  caffeine: ${caffeineTodayMg} mg${caffeineSources ? ` (${caffeineSources})` : ''}
  food: ${calToday} cal · ${proteinToday}g protein · ${carbsToday}g carbs${foodItems ? ` (${foodItems})` : ' (nothing logged)'}
  training: ${trainingToday}
  check-in: ${checkinLine}
— WATER CONTAINERS: his bottle = ${bottleOz} oz, his glass = ${glassOz} oz`

  const catalogBlock = `— NOW: ${localTime} (${today}, timezone ${tz})
— LATEST BODY WEIGHT: ${lastWeight ? `${lastWeight.weight} ${units} on ${lastWeight.date_key}` : 'none logged'}
${todayBlock}

— SUPPLEMENTS (use these [id]s for log_supplement_dose):
${supplementCatalog || '(none configured)'}

— HABITS (use these [id]s for log_habit; log_all_habits marks every manual habit done today):
${habitCatalog || '(none configured)'}

— TRAINING DAYS (splits):
${dayList}

— GYMS:
${gymList}

— EXERCISE CATALOG (use these [id]s):
${exerciseCatalog || '(no exercises yet)'}`

  return { tz, today, units, config, exercises, exerciseById, dayName, supplements, supplementById, loggedSlotsToday, bottleOz, glassOz, habits, habitById, habitDoneToday, catalogBlock }
}

// ── Behavior rules shared by both routes (encodes the confirm-card contract) ──

export const ACTION_RULES = `YOU CAN TAKE ACTIONS via tools. When Luka states something loggable — a set, a supplement taken, weight, water, caffeine, a journal-worthy note, a check-in — CALL THE MATCHING TOOL to PROPOSE it. Each proposal becomes a confirm card he taps, so do NOT say "done" or "logged" yourself; say what you're proposing ("Logging 135×8 — confirm below"). Multiple statements in one message → multiple tool calls in the same turn.

HARD RULES:
- Propose only what he actually said or clearly implied. NEVER invent numbers. If a required value is missing ("log my weight" with no number) or the transcript is garbled, call the clarify tool instead of guessing.
- Reference supplements and exercises by their [id] from the context. If a name doesn't match anything, clarify with the closest matches as options.
- Supplement time_slot: pick the slot from the supplement's configured slots nearest the current time; if it only has one, use it; if none, use "anytime". If that supplement+slot is marked ALREADY LOGGED TODAY, don't re-propose it — mention it's already logged.
- "same as last time" → use the exercise's last set from the catalog.
- Keep text terse — one short line, then the cards speak for themselves.
- NEVER reply with tool calls alone. Structure every reply as: FIRST your text (1-3 short sentences — including the answer to anything he asked; the cards only confirm logging, they don't answer questions), THEN the tool calls.
- When you call clarify, include likely answers as options when you can (e.g. offer his latest logged weight when clarifying a weight).

HABITS: "log my pushups" / "did my hang" / "mark read done" → log_habit with the habit [id] from the HABITS list. "log everything" / "log all my habits" → log_all_habits. A habit tick is only for that manual checklist — water, supplements, food, weight, caffeine, and sets keep their own tools.

FOOD: when he says he ate or drank something caloric, call log_food with a calorie/macro estimate. Set is_hydrating + volume_oz for water-like drinks (juice, milk, sports drinks, soda); false for coffee/alcohol/milkshakes. Only ask a portion question (via clarify) when it's genuinely ambiguous AND high-impact — otherwise estimate and set confidence honestly (low if you had to guess). PLAIN WATER is NOT food: "drank 20 oz of water" → log_water, never log_food.
${PORTION_STYLE_RULES}`

// ── Tool definitions ──────────────────────────────────────────────────────────

export function buildAssistantTools(units: string): Anthropic.Tool[] {
  return [
    // Logging tools
    {
      name: 'log_set',
      description: 'Propose logging a completed set. Call when Luka states an exercise with weight and reps (e.g. "did bench 8 at 135"). Use the exercise [id] from the catalog.',
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
      name: 'log_supplement_dose',
      description: 'Propose logging that a supplement was taken today. Call when Luka says he took a supplement (e.g. "took my magnesium"). Use the supplement [id] from the context.',
      input_schema: {
        type: 'object',
        properties: {
          supplement_id: { type: 'string', description: 'Supplement [id] from the context' },
          time_slot: { type: 'string', enum: TIME_SLOTS },
        },
        required: ['supplement_id', 'time_slot'],
      },
    },
    {
      name: 'log_weight',
      description: `Propose logging today's body weight. Call ONLY when Luka states a number ("weight is 176"). No number → clarify instead.`,
      input_schema: {
        type: 'object',
        properties: { weight: { type: 'number', description: `Body weight in ${units}` } },
        required: ['weight'],
      },
    },
    {
      name: 'log_water',
      description: 'Propose logging plain water. Call when Luka says he drank water. Pass amount_oz when he states an amount ("had 20 oz", "drank a liter" → 33.8). When he says "a bottle" or "a glass", pass bottles/glasses instead — Atlas converts from his configured container sizes; do NOT guess ounces for a bottle.',
      input_schema: {
        type: 'object',
        properties: {
          amount_oz: { type: 'number', description: 'Exact ounces, when he states an amount' },
          bottles: { type: 'number', description: 'Count of his bottles ("drank a bottle" → 1)' },
          glasses: { type: 'number', description: 'Count of his glasses' },
        },
      },
    },
    {
      name: 'log_caffeine',
      description: 'Propose logging caffeine. Call when Luka mentions coffee/energy drink/pre-workout. Estimate mg from the source if he doesn\'t give one (coffee ≈ 95mg, espresso shot ≈ 63mg, energy drink ≈ 160mg).',
      input_schema: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'e.g. "Coffee", "Celsius", "Pre-workout"' },
          amount_mg: { type: 'number' },
        },
        required: ['source', 'amount_mg'],
      },
    },
    {
      name: 'log_food',
      description: 'Propose logging food or a caloric/flavored drink. Call when Luka says he ate or drank something with calories ("had a chicken burrito", "drank a 12oz orange juice"). Estimate calories + macros from the description using the portion rules. Do NOT use for plain water — that is log_water.',
      input_schema: {
        type: 'object',
        properties: {
          item_name: { type: 'string', description: 'Short title-style name, under 60 chars' },
          calories: { type: 'number' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number' },
          portion_desc: { type: 'string', description: 'Human-readable relatable portion, e.g. "palm-sized grilled chicken breast" or "1 tall glass"' },
          is_hydrating: { type: 'boolean', description: 'true for water-like drinks (juice, milk, sports drinks, soda); false for food, coffee, alcohol, milkshakes' },
          volume_oz: { type: 'number', description: 'Fluid ounces — only when is_hydrating is true' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          notes: { type: 'string', description: 'One short sentence on what drove the estimate' },
        },
        required: ['item_name', 'calories', 'protein_g', 'carbs_g', 'portion_desc', 'is_hydrating', 'confidence'],
      },
    },
    {
      name: 'add_journal_note',
      description: 'Propose saving a freeform thought/reflection as a journal entry. Call when Luka says "note that…", "journal this…", or shares a reflection he clearly wants kept.',
      input_schema: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'The note text, cleaned up from speech but in his voice' },
          mood: { type: 'integer', minimum: 1, maximum: 5, description: 'Only if he stated how he feels' },
        },
        required: ['body'],
      },
    },
    {
      name: 'checkin_note',
      description: 'Propose saving a daily check-in. Morning = whether training is planned today (+ intent). Evening = whether he actually trained (+ reflection). Call when he says things like "planning to hit legs today" or "done for the day, trained hard".',
      input_schema: {
        type: 'object',
        properties: {
          slot: { type: 'string', enum: ['morning', 'evening'] },
          trained: { type: 'boolean', description: 'morning: training planned; evening: actually trained' },
          text: { type: 'string', description: 'Optional intent (morning) or reflection (evening)' },
        },
        required: ['slot', 'trained'],
      },
    },
    {
      name: 'log_habit',
      description: 'Propose marking one of Luka\'s habits done today (e.g. "log my pushups", "did my hang", "mark read done"). Use the habit [id] from the HABITS context. If it is marked ALREADY DONE TODAY, say so rather than re-proposing. Water/supplements/food/weight/sets keep their own tools — this is only for the manual habit checklist.',
      input_schema: {
        type: 'object',
        properties: { habit_id: { type: 'string', description: 'Habit [id] from the HABITS context' } },
        required: ['habit_id'],
      },
    },
    {
      name: 'log_all_habits',
      description: 'Propose marking ALL of today\'s manual habits done at once. Call when Luka says "log everything", "log all my habits", or "mark all habits done".',
      input_schema: { type: 'object', properties: {} },
    },
    // Clarification
    {
      name: 'clarify',
      description: 'Ask ONE short clarifying question when a required value is missing, a name is ambiguous, or the transcript is garbled. Provide up to 4 short tappable options when sensible.',
      input_schema: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short answer options' },
        },
        required: ['question'],
      },
    },
    // Gym coach tools (ported from /api/gym/chat)
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
      description: "Propose a whole workout (a set of exercises) to place into the user's days. Set existing_day_id to add to an existing day, or leave it null to create a new day named day_name.",
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
}

// ── Resolve a raw tool call into a validated proposal ────────────────────────

const num = (v: unknown): number | null => (typeof v === 'number' && !Number.isNaN(v) ? v : null)

export type ResolvedToolCall =
  | { type: 'action'; action: AssistantAction }
  | { type: 'clarify'; question: string; options: string[] }
  | null

export function resolveToolCall(name: string, input: Record<string, unknown>, ctx: AssistantContext): ResolvedToolCall {
  const { exerciseById, supplementById, config, dayName } = ctx
  const action = ((): AssistantAction | null => {
    switch (name) {
      case 'log_set': {
        const ex = exerciseById.get(String(input.exercise_id))
        const weight = num(input.weight), reps = num(input.reps)
        if (!ex || weight == null || reps == null) return null
        return { kind: 'log_set', exercise_id: ex.id, exercise_name: ex.name, weight, reps }
      }
      case 'log_supplement_dose': {
        const supp = supplementById.get(String(input.supplement_id))
        if (!supp) return null
        const slot = (TIME_SLOTS as string[]).includes(String(input.time_slot)) ? String(input.time_slot) as TimeSlot : 'anytime'
        const already = ctx.loggedSlotsToday.get(supp.id)?.has(slot) ?? false
        return { kind: 'log_supplement_dose', supplement_id: supp.id, supplement_name: supp.name, time_slot: slot, already_logged: already }
      }
      case 'log_weight': {
        const weight = num(input.weight)
        if (weight == null || weight <= 0 || weight > 1000) return null
        return { kind: 'log_weight', weight }
      }
      case 'log_water': {
        // amount_oz, or bottles/glasses converted from his configured sizes (MCP parity)
        const oz = num(input.amount_oz) ?? 0
        const bottles = num(input.bottles) ?? 0
        const glasses = num(input.glasses) ?? 0
        const total = Math.round((oz + bottles * ctx.bottleOz + glasses * ctx.glassOz) * 10) / 10
        if (total <= 0 || total > 300) return null
        return { kind: 'log_water', amount_oz: total }
      }
      case 'log_caffeine': {
        const mg = num(input.amount_mg)
        const source = String(input.source || '').trim()
        if (!source || mg == null || mg <= 0 || mg > 1000) return null
        return { kind: 'log_caffeine', source, amount_mg: Math.round(mg) }
      }
      case 'log_food': {
        const item_name = String(input.item_name || '').trim().slice(0, 80)
        const calories = num(input.calories)
        if (!item_name || calories == null || calories < 0 || calories > 20000) return null
        const is_hydrating = !!input.is_hydrating
        const volRaw = num(input.volume_oz)
        const conf = (['low', 'medium', 'high'] as const).includes(input.confidence as 'low' | 'medium' | 'high')
          ? (input.confidence as 'low' | 'medium' | 'high') : 'low'
        return {
          kind: 'log_food',
          item_name,
          calories: Math.round(calories),
          protein_g: Math.max(0, num(input.protein_g) ?? 0),
          carbs_g: Math.max(0, num(input.carbs_g) ?? 0),
          portion_desc: String(input.portion_desc || '').trim().slice(0, 120) || item_name,
          is_hydrating,
          volume_oz: is_hydrating && volRaw != null && volRaw > 0 ? Math.round(volRaw * 10) / 10 : null,
          confidence: conf,
          notes: String(input.notes || '').trim().slice(0, 300),
        }
      }
      case 'add_journal_note': {
        const body = String(input.body || '').trim()
        if (!body) return null
        const mood = num(input.mood)
        return { kind: 'add_journal_note', body: body.slice(0, 10000), mood: mood != null && mood >= 1 && mood <= 5 ? Math.round(mood) : null }
      }
      case 'checkin_note': {
        const slot = input.slot === 'evening' ? 'evening' : input.slot === 'morning' ? 'morning' : null
        if (!slot || typeof input.trained !== 'boolean') return null
        const text = String(input.text || '').trim()
        return { kind: 'checkin_note', slot, trained: input.trained, text: text ? text.slice(0, 500) : null }
      }
      case 'log_habit': {
        const h = ctx.habitById.get(String(input.habit_id))
        if (!h) return null
        return { kind: 'log_habit', habit_id: h.id, habit_name: h.name, already_done: ctx.habitDoneToday.has(h.id) }
      }
      case 'log_all_habits':
        return { kind: 'log_all_habits' }
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
  })()

  if (action) return { type: 'action', action }

  if (name === 'clarify') {
    const question = String(input.question || '').trim()
    if (!question) return null
    const options = (Array.isArray(input.options) ? input.options : [])
      .map(o => String(o).trim()).filter(Boolean).slice(0, 4)
    return { type: 'clarify', question, options }
  }

  return null
}
