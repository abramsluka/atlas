import { createServiceClient } from '@/lib/supabase/server'
import { formatInTimeZone } from 'date-fns-tz'
import { daysAgoLocal } from '@/lib/date'

type DB = ReturnType<typeof createServiceClient>

// 12 weeks back is plenty for a weeks-on-target streak; cheap to query.
const LOOKBACK_DAYS = 84

// Cardio auto-derivation is DORMANT for now (Cardio is seeded as manual). When
// it's flipped to kind='auto' source='cardio', these workout_type substrings are
// what count as a cardio day in apple_workouts. Kept here so turning it on is a
// one-field change, not new code.
const CARDIO_TYPES = [
  'run', 'jog', 'cycl', 'ride', 'row', 'elliptical', 'climb', 'boulder',
  'hike', 'swim', 'hiit', 'walk', 'cardio', 'conditioning',
]

export interface HabitDay {
  date: string       // YYYY-MM-DD (local)
  done: boolean
  today: boolean
  future: boolean    // later this week, not yet reachable
}

export interface HabitView {
  id: string
  name: string
  emoji: string
  kind: 'auto' | 'manual'
  source: string | null
  perWeek: number
  order: number
  week: HabitDay[]     // current week, Monday → Sunday
  weeklyDone: number   // done days so far this week
  streakWeeks: number  // consecutive weeks that met target (grace on current)
}

interface HabitRow {
  id: string
  name: string
  emoji: string | null
  kind: 'auto' | 'manual'
  source: string | null
  cadence: { per_week?: number } | null
  order_index: number | null
}

function union(a: Set<string>, b: Set<string>): Set<string> {
  const s = new Set(a)
  for (const x of b) s.add(x)
  return s
}

// 0 = today is Monday … 6 = today is Sunday. Local to the user's tz.
function mondayOffset(tz: string): number {
  return Number(formatInTimeZone(new Date(), tz, 'i')) - 1
}

// The seven local dates of a week, Monday → Sunday. weekOffset 0 = this week.
function weekDates(tz: string, weekOffset: number): string[] {
  const base = mondayOffset(tz) + 7 * weekOffset
  const out: string[] = []
  for (let k = 0; k < 7; k++) out.push(daysAgoLocal(base - k, tz))
  return out
}

function countWeek(done: Set<string>, tz: string, weekOffset: number): number {
  return weekDates(tz, weekOffset).reduce((c, d) => c + (done.has(d) ? 1 : 0), 0)
}

function currentWeek(done: Set<string>, tz: string): HabitDay[] {
  const today = daysAgoLocal(0, tz)
  return weekDates(tz, 0).map((d) => ({
    date: d,
    done: done.has(d),
    today: d === today,
    future: d > today,
  }))
}

// Consecutive weeks that hit the weekly target, walking back from now. GRACE:
// the current week is still in progress, so if it hasn't hit target yet it does
// NOT break the streak — it just doesn't add to it. Once it hits target it
// counts. A past full week below target ends the streak.
function streakWeeks(done: Set<string>, tz: string, perWeek: number): number {
  let streak = countWeek(done, tz, 0) >= perWeek ? 1 : 0
  const maxWeeks = Math.floor(LOOKBACK_DAYS / 7)
  for (let w = 1; w < maxWeeks; w++) {
    if (countWeek(done, tz, w) >= perWeek) streak++
    else break
  }
  return streak
}

// One read of every source a habit might derive from, then a done-day Set per
// habit. Mirrors src/lib/home/streaks.ts, but produces weekly-target metrics
// instead of the strip's consecutive-day streak.
export async function computeHabits(db: DB, userId: string, tz: string): Promise<HabitView[]> {
  const dateCutoff = daysAgoLocal(LOOKBACK_DAYS, tz)

  const [habitsR, complR, waterR, profileR, cardioR] = await Promise.allSettled([
    db.from('habits').select('id, name, emoji, kind, source, cadence, order_index')
      .eq('user_id', userId).eq('active', true).order('order_index', { ascending: true }),
    db.from('habit_completions').select('habit_id, date, completed')
      .eq('user_id', userId).gte('date', dateCutoff),
    db.from('water_logs').select('date, amount_oz').eq('user_id', userId).gte('date', dateCutoff),
    db.from('health_profile').select('daily_water_target_oz').eq('user_id', userId).maybeSingle(),
    db.from('apple_workouts').select('date, workout_type').eq('user_id', userId).gte('date', dateCutoff),
  ])

  const habits = (habitsR.status === 'fulfilled' ? habitsR.value.data ?? [] : []) as HabitRow[]

  // Manual ticks + overrides, grouped by habit. Absent/false rows are ignored.
  const overridesByHabit = new Map<string, Set<string>>()
  if (complR.status === 'fulfilled') {
    for (const row of (complR.value.data ?? []) as Array<{ habit_id: string; date: string; completed: boolean }>) {
      if (!row.completed || !row.date) continue
      let s = overridesByHabit.get(row.habit_id)
      if (!s) { s = new Set(); overridesByHabit.set(row.habit_id, s) }
      s.add(row.date)
    }
  }

  // Water auto-source: a day counts when total oz meets the target (any oz if no
  // target). Same rule the Consistency strip uses.
  const waterDates = new Set<string>()
  {
    const target = profileR.status === 'fulfilled'
      ? ((profileR.value.data as { daily_water_target_oz: number | null } | null)?.daily_water_target_oz ?? null)
      : null
    const byDay = new Map<string, number>()
    if (waterR.status === 'fulfilled') {
      for (const r of (waterR.value.data ?? []) as Array<{ date: string; amount_oz: number | null }>) {
        if (!r.date) continue
        byDay.set(r.date, (byDay.get(r.date) ?? 0) + (r.amount_oz ?? 0))
      }
    }
    for (const [d, t] of byDay) if (target ? t >= target : t > 0) waterDates.add(d)
  }

  // Cardio auto-source (dormant): a day counts when a cardio-type apple_workout
  // lands on it. Free-text type, so allowlist-filtered.
  const cardioDates = new Set<string>()
  if (cardioR.status === 'fulfilled') {
    for (const r of (cardioR.value.data ?? []) as Array<{ date: string | null; workout_type: string | null }>) {
      if (!r.date) continue
      const t = (r.workout_type ?? '').toLowerCase()
      if (!t || CARDIO_TYPES.some((k) => t.includes(k))) cardioDates.add(r.date)
    }
  }

  return habits.map((h) => {
    const overrides = overridesByHabit.get(h.id) ?? new Set<string>()
    let done: Set<string>
    if (h.kind === 'auto' && h.source === 'water') done = union(waterDates, overrides)
    else if (h.kind === 'auto' && h.source === 'cardio') done = union(cardioDates, overrides)
    else done = overrides
    const perWeek = h.cadence?.per_week ?? 7
    return {
      id: h.id,
      name: h.name,
      emoji: h.emoji ?? '•',
      kind: h.kind,
      source: h.source,
      perWeek,
      order: h.order_index ?? 0,
      week: currentWeek(done, tz),
      weeklyDone: countWeek(done, tz, 0),
      streakWeeks: streakWeeks(done, tz, perWeek),
    }
  })
}
