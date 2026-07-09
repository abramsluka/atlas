import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { fromZonedTime } from 'date-fns-tz'
import { createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, DAY_ROLLOVER_HOUR } from '@/lib/date'
import { logFoodServer } from '@/features/food/logFoodServer'
import type { OuraData, WhoopData } from '@/features/health/types'

export const ATLAS_INSTRUCTIONS =
  "Atlas is Luka's personal life-OS (fitness, nutrition, sleep, journaling). Dates are YYYY-MM-DD in the user's timezone. Weights lbs, water oz, caffeine mg. Atlas tracks calories/protein/carbs only (no fat)."

// ─── result + auth helpers ───────────────────────────────────────────────────

type ToolResult = { content: [{ type: 'text'; text: string }]; isError?: boolean }

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
})

const err = (message: string, extra?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message, ...extra }) }],
  isError: true,
})

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// withMcpAuth guarantees authInfo; its extra.userId is set by verifyToken.
function userIdOf(extra: { authInfo?: AuthInfo }): string {
  const uid = extra.authInfo?.extra?.userId
  if (typeof uid !== 'string') throw new Error('No user resolved for this token')
  return uid
}

// ─── date helpers ────────────────────────────────────────────────────────────

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .describe("YYYY-MM-DD. Defaults to today in the user's timezone.")

async function todayFor(userId: string): Promise<string> {
  return toLocalDate(await getUserTimezone(userId))
}

// UTC instants bounding an app day in the user's timezone (for timestamptz
// columns like gym_logs.logged_at, which have no date column). Runs
// [date 3am, date+1 3am) local — the shared DAY_ROLLOVER_HOUR boundary.
async function dayWindow(userId: string, date: string): Promise<{ start: string; end: string }> {
  const tz = await getUserTimezone(userId)
  const hh = `${String(DAY_ROLLOVER_HOUR).padStart(2, '0')}:00:00`
  const start = fromZonedTime(`${date}T${hh}`, tz)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ─── misc helpers ────────────────────────────────────────────────────────────

const r1 = (n: number) => Math.round(n * 10) / 10

// Drop null/undefined values; returns undefined if nothing survives.
function compact(obj: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) if (v !== null && v !== undefined) out[k] = v
  return Object.keys(out).length ? out : undefined
}

// Supabase embedded relations come back object-or-array depending on FK shape.
function relName(rel: unknown): string | null {
  if (Array.isArray(rel)) return (rel[0] as { name?: string } | undefined)?.name ?? null
  return (rel as { name?: string } | null)?.name ?? null
}

// Resolve a fuzzy name against ilike matches: a single hit wins, an exact
// (case-insensitive) hit breaks ties, anything else is ambiguous.
function pickByName<T extends { name: string }>(matches: T[], query: string): T | null {
  if (matches.length === 1) return matches[0]
  const exact = matches.find((m) => m.name.toLowerCase() === query.trim().toLowerCase())
  return exact ?? null
}

// ─── tool registration ───────────────────────────────────────────────────────

export function registerAtlasTools(server: McpServer) {
  server.registerTool(
    'log_food',
    {
      description:
        'Log food or a caloric drink the user consumed. Call this when the user mentions eating or drinking something and wants it tracked. Estimate calories, protein_g and carbs_g yourself before calling (Atlas does not track fat). For drinks, set is_drink and volume_oz.',
      inputSchema: {
        item_name: z.string().min(1).describe('Short name of the food or drink, e.g. "chicken burrito"'),
        calories: z.number().min(0),
        protein_g: z.number().min(0),
        carbs_g: z.number().min(0),
        notes: z.string().optional(),
        is_drink: z.boolean().optional().describe('True for drinks — also logs water for the volume'),
        volume_oz: z.number().positive().optional().describe('Drink volume in ounces (with is_drink)'),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const item_name = args.item_name.trim().slice(0, 80)
        const is_drink = Boolean(args.is_drink)
        const result = await logFoodServer(db, userId, {
          item_name,
          calories: Math.round(args.calories),
          protein_g: args.protein_g,
          carbs_g: args.carbs_g,
          portion_desc: item_name,
          is_hydrating: is_drink,
          volume_oz: is_drink && args.volume_oz != null ? args.volume_oz : null,
          barcode: null,
          brand: null,
          confidence: 'medium',
          notes: args.notes?.trim() || null,
          source: is_drink ? 'drink' : 'text',
        })
        if (result.error || !result.entry) return err(result.error ?? 'insert failed')

        const date = result.entry.date as string
        const { data: dayRows } = await db
          .from('food_logs')
          .select('calories, protein_g, carbs_g')
          .eq('user_id', userId)
          .eq('date', date)
        const totals = (dayRows ?? []).reduce(
          (t, r) => ({
            calories: t.calories + (r.calories ?? 0),
            protein_g: t.protein_g + (r.protein_g ?? 0),
            carbs_g: t.carbs_g + (r.carbs_g ?? 0),
          }),
          { calories: 0, protein_g: 0, carbs_g: 0 }
        )
        return ok({
          saved: {
            item_name,
            calories: result.entry.calories,
            protein_g: result.entry.protein_g,
            carbs_g: result.entry.carbs_g,
            date,
          },
          water_logged: result.waterLogged,
          day_totals: { calories: totals.calories, protein_g: r1(totals.protein_g), carbs_g: r1(totals.carbs_g) },
        })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'log_water',
    {
      description:
        "Log plain water intake. Call when the user mentions drinking water. Pass amount_oz when they give an amount; when they say 'a bottle' or 'a glass', pass bottles or glasses instead — Atlas converts using their configured container sizes (do NOT guess ounces for a bottle). For caloric or hydrating drinks (juice, protein shake), use log_food with is_drink instead.",
      inputSchema: {
        amount_oz: z.number().positive().optional().describe('Exact ounces, when the user states an amount'),
        bottles: z.number().positive().optional().describe("Count of the user's configured bottles"),
        glasses: z.number().positive().optional().describe("Count of the user's configured glasses"),
        date: dateSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        if (args.amount_oz == null && args.bottles == null && args.glasses == null) {
          return err('Pass amount_oz, bottles or glasses.')
        }
        const db = createServiceClient()
        const date = args.date ?? (await todayFor(userId))

        const OZ_PER_ML = 1 / 29.5735
        let bottleOz: number | null = null
        let amountOz = args.amount_oz ?? 0
        if (args.bottles != null || args.glasses != null) {
          const { data: profile } = await db
            .from('health_profile')
            .select('bottle_ml, glass_ml')
            .eq('user_id', userId)
            .maybeSingle()
          bottleOz = r1((profile?.bottle_ml ?? 500) * OZ_PER_ML)
          const glassOz = r1((profile?.glass_ml ?? 250) * OZ_PER_ML)
          amountOz += (args.bottles ?? 0) * bottleOz + (args.glasses ?? 0) * glassOz
        }
        amountOz = r1(amountOz)

        const { error } = await db
          .from('water_logs')
          .insert({ user_id: userId, date, amount_oz: amountOz })
        if (error) return err(error.message)
        const { data: rows } = await db
          .from('water_logs')
          .select('amount_oz')
          .eq('user_id', userId)
          .eq('date', date)
        const day_total_oz = r1((rows ?? []).reduce((t, r) => t + (r.amount_oz ?? 0), 0))
        const result: Record<string, unknown> = { logged_oz: amountOz, date, day_total_oz }
        if (bottleOz) result.day_total_bottles = r1(day_total_oz / bottleOz)
        return ok(result)
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'log_weight',
    {
      description:
        "Record the user's body weight in pounds for a date (default today). Overwrites that day's entry.",
      inputSchema: {
        weight: z.number().positive().describe('Body weight in pounds'),
        date: dateSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const date = args.date ?? (await todayFor(userId))
        const { error } = await db
          .from('body_weights')
          .upsert({ user_id: userId, date_key: date, weight: args.weight }, { onConflict: 'user_id,date_key' })
        if (error) return err(error.message)
        return ok({ saved: { date, weight_lbs: args.weight } })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'log_caffeine',
    {
      description:
        'Log caffeine intake. Call when the user mentions coffee, espresso, tea, an energy drink or pre-workout. Estimate amount_mg from the drink if not stated (coffee ≈ 95mg, espresso shot ≈ 65mg, energy drink ≈ 160mg).',
      inputSchema: {
        amount_mg: z.number().positive(),
        source: z.string().min(1).describe('What it came from, e.g. "coffee", "espresso", "Celsius"'),
        date: dateSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const date = args.date ?? (await todayFor(userId))
        const { error } = await db
          .from('caffeine_logs')
          .insert({ user_id: userId, date, source: args.source.trim(), amount_mg: args.amount_mg })
        if (error) return err(error.message)
        const { data: rows } = await db
          .from('caffeine_logs')
          .select('amount_mg')
          .eq('user_id', userId)
          .eq('date', date)
        const day_total_mg = (rows ?? []).reduce((t, r) => t + (r.amount_mg ?? 0), 0)
        return ok({ logged_mg: args.amount_mg, source: args.source.trim(), date, day_total_mg })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'log_supplement',
    {
      description:
        "Mark one of the user's configured supplements as taken. Call when the user says they took a supplement (creatine, vitamin D, etc.). Uses fuzzy name matching against their supplement list.",
      inputSchema: {
        name: z.string().min(1),
        time_slot: z.enum(['morning', 'lunch', 'evening', 'anytime']).optional(),
        date: dateSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const date = args.date ?? (await todayFor(userId))
        const time_slot = args.time_slot ?? 'anytime'

        const { data: matches, error: lookupError } = await db
          .from('supplements')
          .select('id, name')
          .eq('user_id', userId)
          .eq('active', true)
          .ilike('name', `%${args.name.trim()}%`)
        if (lookupError) return err(lookupError.message)

        const match = pickByName(matches ?? [], args.name)
        if (!match) {
          const { data: all } = await db
            .from('supplements')
            .select('name')
            .eq('user_id', userId)
            .eq('active', true)
            .order('name')
          const active = (all ?? []).map((s) => s.name)
          if ((matches ?? []).length > 1) {
            return err(`Ambiguous supplement name "${args.name}" — retry with one of the candidates.`, {
              candidates: (matches ?? []).map((m) => m.name),
            })
          }
          return err(`No active supplement matches "${args.name}" — retry with one from the list.`, {
            active_supplements: active,
          })
        }

        const { error } = await db
          .from('supplement_logs')
          .insert({ user_id: userId, supplement_id: match.id, date, time_slot })
        if (error) {
          if (error.code === '23505') {
            return ok({ already_logged: true, supplement: match.name, date, time_slot })
          }
          return err(error.message)
        }
        return ok({ logged: match.name, date, time_slot })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'log_gym_set',
    {
      description:
        "Log one completed set of a gym exercise (weight in lbs, reps). Call once per set when the user reports lifting. Exercise must match one they've configured; on ambiguity you'll get candidates back.",
      inputSchema: {
        exercise: z.string().min(1),
        weight: z.number().min(0).describe('Weight in pounds; 0 for bodyweight'),
        reps: z.number().int().positive(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()

        const { data: matches, error: lookupError } = await db
          .from('gym_exercises')
          .select('id, name')
          .eq('user_id', userId)
          .ilike('name', `%${args.exercise.trim()}%`)
        if (lookupError) return err(lookupError.message)

        const match = pickByName(matches ?? [], args.exercise)
        if (!match) {
          if ((matches ?? []).length > 1) {
            return err(`Ambiguous exercise name "${args.exercise}" — retry with one of the candidates.`, {
              candidates: (matches ?? []).map((m) => m.name),
            })
          }
          const { data: all } = await db
            .from('gym_exercises')
            .select('name')
            .eq('user_id', userId)
            .order('name')
          return err(`No configured exercise matches "${args.exercise}" — retry with one from the list.`, {
            exercises: (all ?? []).map((e) => e.name),
          })
        }

        const { error } = await db
          .from('gym_logs')
          .insert({ user_id: userId, exercise_id: match.id, weight: args.weight, reps: args.reps })
        if (error) return err(error.message)
        return ok({ logged: { exercise: match.name, weight: args.weight, reps: args.reps } })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'add_jot',
    {
      description:
        "Save a quick thought, idea or note to the user's jots inbox. Call when the user says 'jot this down', 'note this', or shares a passing thought they want captured.",
      inputSchema: {
        content: z.string().min(1),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const { error } = await db
          .from('jots')
          .insert({ user_id: userId, content: args.content.trim() })
        if (error) return err(error.message)
        return ok({ saved: true })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'add_journal_entry',
    {
      description:
        'Create a journal entry. Call when the user wants to journal or reflect at length — for short passing thoughts use add_jot instead. mood is 1 (low) to 5 (great).',
      inputSchema: {
        body: z.string().min(1),
        mood: z.number().int().min(1).max(5).optional(),
        title: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const date = await todayFor(userId)
        const { error } = await db.from('journal_entries').insert({
          user_id: userId,
          date,
          title: args.title?.trim() || null,
          body: args.body,
          mood: args.mood ?? null,
        })
        if (error) return err(error.message)
        return ok({ saved: { date, title: args.title?.trim() || null, mood: args.mood ?? null } })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'get_daily_summary',
    {
      description:
        "Get the user's full day snapshot: sleep and recovery (Oura/Whoop), food and macros, water, caffeine, weight, supplements taken, gym sets, steps and check-ins. Call for questions like 'how am I doing today' or before giving any health/coaching commentary.",
      inputSchema: {
        date: dateSchema.optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const tz = await getUserTimezone(userId)
        const date = args.date ?? toLocalDate(tz)
        const window = await dayWindow(userId, date)

        const [wearables, food, water, caffeine, weight, suppLogs, suppList, checkin, gym, apple] =
          await Promise.all([
            db.from('wearable_data').select('provider, data').eq('user_id', userId).eq('date', date),
            db.from('food_logs').select('item_name, calories, protein_g, carbs_g').eq('user_id', userId).eq('date', date),
            db.from('water_logs').select('amount_oz').eq('user_id', userId).eq('date', date),
            db.from('caffeine_logs').select('source, amount_mg').eq('user_id', userId).eq('date', date),
            db.from('body_weights').select('date_key, weight').eq('user_id', userId).lte('date_key', date).order('date_key', { ascending: false }).limit(1),
            db.from('supplement_logs').select('time_slot, supplements(name)').eq('user_id', userId).eq('date', date),
            db.from('supplements').select('name').eq('user_id', userId).eq('active', true),
            db.from('daily_checkins').select('morning_planned_training, morning_intent, evening_actual_training, evening_reflection').eq('user_id', userId).eq('date', date).maybeSingle(),
            db.from('gym_logs').select('weight, reps, gym_exercises(name)').eq('user_id', userId).gte('logged_at', window.start).lt('logged_at', window.end).order('logged_at'),
            db.from('apple_health_logs').select('steps, active_calories').eq('user_id', userId).eq('date', date).maybeSingle(),
          ])

        const summary: Record<string, unknown> = { date }

        const ouraRaw = wearables.data?.find((r) => r.provider === 'oura')?.data as OuraData | undefined
        if (ouraRaw) {
          const oura = compact({
            sleep_score: ouraRaw.sleep?.score,
            sleep_hours:
              ouraRaw.sleep?.total_sleep_duration != null
                ? r1(ouraRaw.sleep.total_sleep_duration / 3600)
                : undefined,
            avg_hrv_ms: ouraRaw.sleep?.average_hrv,
            resting_hr: ouraRaw.sleep?.resting_heart_rate,
            readiness_score: ouraRaw.readiness?.score,
          })
          if (oura) summary.oura = oura
        }

        const whoopRaw = wearables.data?.find((r) => r.provider === 'whoop')?.data as WhoopData | undefined
        if (whoopRaw) {
          const whoop = compact({
            recovery_score: whoopRaw.recovery?.score,
            hrv_ms: whoopRaw.recovery?.hrv_rmssd_milli,
            strain: whoopRaw.cycle?.strain != null ? r1(whoopRaw.cycle.strain) : undefined,
            sleep_hours:
              whoopRaw.sleep?.duration_seconds != null
                ? r1(whoopRaw.sleep.duration_seconds / 3600)
                : undefined,
          })
          if (whoop) summary.whoop = whoop
        }

        if (food.data?.length) {
          const totals = food.data.reduce(
            (t, r) => ({
              calories: t.calories + (r.calories ?? 0),
              protein_g: t.protein_g + (r.protein_g ?? 0),
              carbs_g: t.carbs_g + (r.carbs_g ?? 0),
            }),
            { calories: 0, protein_g: 0, carbs_g: 0 }
          )
          summary.food = {
            totals: { calories: totals.calories, protein_g: r1(totals.protein_g), carbs_g: r1(totals.carbs_g) },
            items: food.data.map((r) => r.item_name),
          }
        }

        const waterOz = (water.data ?? []).reduce((t, r) => t + (r.amount_oz ?? 0), 0)
        if (waterOz > 0) summary.water_oz = waterOz

        const caffeineMg = (caffeine.data ?? []).reduce((t, r) => t + (r.amount_mg ?? 0), 0)
        if (caffeineMg > 0) summary.caffeine_mg = caffeineMg

        const latestWeight = weight.data?.[0]
        if (latestWeight) summary.weight = { lbs: latestWeight.weight, as_of: latestWeight.date_key }

        const taken = (suppLogs.data ?? [])
          .map((r) => ({ name: relName(r.supplements), time_slot: r.time_slot }))
          .filter((s): s is { name: string; time_slot: string } => s.name != null)
        const configured = (suppList.data ?? []).map((s) => s.name)
        if (taken.length || configured.length) {
          const takenNames = new Set(taken.map((t) => t.name))
          summary.supplements = {
            taken,
            not_taken: configured.filter((n) => !takenNames.has(n)),
          }
        }

        if (gym.data?.length) {
          summary.gym = {
            set_count: gym.data.length,
            sets: gym.data.map((r) => ({ exercise: relName(r.gym_exercises), weight: r.weight, reps: r.reps })),
          }
        }

        if (apple.data?.steps != null) summary.steps = apple.data.steps

        if (checkin.data) {
          const c = compact(checkin.data as Record<string, unknown>)
          if (c) summary.checkin = c
        }

        return ok(summary)
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'get_food_history',
    {
      description:
        'Get daily food totals and items for the last N days. Call for questions about eating patterns, calorie/protein averages or trends.',
      inputSchema: {
        days: z.number().int().min(1).max(30).optional().describe('Default 7, max 30'),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const days = args.days ?? 7
        const today = await todayFor(userId)
        const start = new Date(`${today}T00:00:00Z`)
        start.setUTCDate(start.getUTCDate() - (days - 1))
        const startDate = start.toISOString().slice(0, 10)

        const { data, error } = await db
          .from('food_logs')
          .select('date, item_name, calories, protein_g, carbs_g')
          .eq('user_id', userId)
          .gte('date', startDate)
          .order('date', { ascending: false })
        if (error) return err(error.message)

        const byDate = new Map<string, { calories: number; protein_g: number; carbs_g: number; items: string[] }>()
        for (const r of data ?? []) {
          const day = byDate.get(r.date) ?? { calories: 0, protein_g: 0, carbs_g: 0, items: [] }
          day.calories += r.calories ?? 0
          day.protein_g += r.protein_g ?? 0
          day.carbs_g += r.carbs_g ?? 0
          day.items.push(r.item_name)
          byDate.set(r.date, day)
        }
        return ok({
          days: [...byDate.entries()].map(([date, d]) => ({
            date,
            calories: d.calories,
            protein_g: r1(d.protein_g),
            carbs_g: r1(d.carbs_g),
            items: d.items,
          })),
        })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'get_gym_progress',
    {
      description:
        "Get strength-training history. Call for questions like 'what's my bench at' or 'when did I last train'. Omit exercise to list all exercises with their latest set.",
      inputSchema: {
        exercise: z.string().optional(),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()

        if (args.exercise?.trim()) {
          const { data: matches, error: lookupError } = await db
            .from('gym_exercises')
            .select('id, name')
            .eq('user_id', userId)
            .ilike('name', `%${args.exercise.trim()}%`)
          if (lookupError) return err(lookupError.message)

          const match = pickByName(matches ?? [], args.exercise)
          if (!match) {
            if ((matches ?? []).length > 1) {
              return err(`Ambiguous exercise name "${args.exercise}" — retry with one of the candidates.`, {
                candidates: (matches ?? []).map((m) => m.name),
              })
            }
            const { data: all } = await db
              .from('gym_exercises')
              .select('name')
              .eq('user_id', userId)
              .order('name')
            return err(`No configured exercise matches "${args.exercise}" — retry with one from the list.`, {
              exercises: (all ?? []).map((e) => e.name),
            })
          }

          const [recent, best] = await Promise.all([
            db.from('gym_logs').select('weight, reps, logged_at').eq('user_id', userId).eq('exercise_id', match.id).order('logged_at', { ascending: false }).limit(15),
            db.from('gym_logs').select('weight, reps, logged_at').eq('user_id', userId).eq('exercise_id', match.id).order('weight', { ascending: false }).order('reps', { ascending: false }).limit(1),
          ])
          if (recent.error) return err(recent.error.message)
          return ok({
            exercise: match.name,
            recent_sets: (recent.data ?? []).map((s) => ({ weight: s.weight, reps: s.reps, at: s.logged_at })),
            heaviest_ever: best.data?.[0]
              ? { weight: best.data[0].weight, reps: best.data[0].reps, at: best.data[0].logged_at }
              : null,
          })
        }

        const [exercises, logs] = await Promise.all([
          db.from('gym_exercises').select('id, name').eq('user_id', userId).order('name'),
          db.from('gym_logs').select('exercise_id, weight, reps, logged_at').eq('user_id', userId).order('logged_at', { ascending: false }).limit(1000),
        ])
        if (exercises.error) return err(exercises.error.message)

        const latest = new Map<string, { weight: number; reps: number; at: string }>()
        for (const l of logs.data ?? []) {
          if (!latest.has(l.exercise_id)) {
            latest.set(l.exercise_id, { weight: l.weight, reps: l.reps, at: l.logged_at })
          }
        }
        return ok({
          exercises: (exercises.data ?? []).map((e) => ({
            name: e.name,
            last_set: latest.get(e.id) ?? null,
          })),
        })
      } catch (e) {
        return err(msg(e))
      }
    }
  )

  server.registerTool(
    'get_journal_recent',
    {
      description:
        "Get the user's recent journal entries (most recent first, bodies truncated). Call when conversation touches on how they've been feeling or what's been on their mind.",
      inputSchema: {
        limit: z.number().int().min(1).max(20).optional().describe('Default 5, max 20'),
      },
    },
    async (args, extra) => {
      try {
        const userId = userIdOf(extra)
        const db = createServiceClient()
        const limit = args.limit ?? 5
        const { data, error } = await db
          .from('journal_entries')
          .select('date, title, mood, body, audio_transcript')
          .eq('user_id', userId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(limit)
        if (error) return err(error.message)
        return ok({
          entries: (data ?? []).map((e) => {
            // Voice entries keep their text in audio_transcript, body is empty
            const text: string = e.body?.trim() ? e.body : (e.audio_transcript ?? '')
            return {
              date: e.date,
              title: e.title,
              mood: e.mood,
              body: text.length > 500 ? `${text.slice(0, 500)}…` : text,
            }
          }),
        })
      } catch (e) {
        return err(msg(e))
      }
    }
  )
}
