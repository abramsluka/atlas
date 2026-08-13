import { createServiceClient } from '@/lib/supabase/server'
import { formatInTimeZone } from 'date-fns-tz'
import { daysAgoLocal } from '@/lib/date'
import { getLiveSession } from '@/lib/liveGymSession'

type DB = ReturnType<typeof createServiceClient>

// How far back we look when walking a streak. A streak longer than this caps
// here — fine for now, cheap to query.
const LOOKBACK_DAYS = 120

export interface StreakStat {
  streak: number      // consecutive days, "grace" rule (today pending doesn't break it)
  weeklyPct: number   // % of last 7 days with activity
  pending?: boolean   // today is in progress, not yet banked (training only)
}

export interface Streaks {
  training: StreakStat
  journal: StreakStat
  food: StreakStat
  supplements: StreakStat
  water: StreakStat
}

// Walk consecutive local days back from today. GRACE rule: if today isn't
// logged yet, we don't break the streak — we start counting from yesterday.
// The streak only resets once a full day passes with nothing logged.
function streakFrom(dates: Set<string>, tz: string): number {
  const start = dates.has(daysAgoLocal(0, tz)) ? 0 : 1
  let count = 0
  for (let n = start; n < LOOKBACK_DAYS; n++) {
    if (dates.has(daysAgoLocal(n, tz))) count++
    else break
  }
  return count
}

function weeklyPct(dates: Set<string>, tz: string): number {
  let c = 0
  for (let n = 0; n < 7; n++) if (dates.has(daysAgoLocal(n, tz))) c++
  return Math.round((c / 7) * 100)
}

function stat(dates: Set<string>, tz: string): StreakStat {
  return { streak: streakFrom(dates, tz), weeklyPct: weeklyPct(dates, tz) }
}

const EMPTY: StreakStat = { streak: 0, weeklyPct: 0 }

// Pure data loader — shared by the /api/home/streaks route and the home server
// component (so the page can fetch this once, server-side, next to Supabase).
export async function computeStreaks(db: DB, userId: string, tz: string): Promise<Streaks> {
  const dateCutoff = daysAgoLocal(LOOKBACK_DAYS, tz)                       // YYYY-MM-DD for date-column tables
  const tsCutoff = new Date(Date.now() - (LOOKBACK_DAYS + 1) * 86400000).toISOString()

  const [gymR, journalR, foodR, suppR, waterR, profileR, checkinR, liveR] = await Promise.allSettled([
    // gym_logs only has logged_at (timestamptz) → convert to local day below
    db.from('gym_logs').select('logged_at').eq('user_id', userId).gte('logged_at', tsCutoff),
    db.from('journal_entries').select('date').eq('user_id', userId).gte('date', dateCutoff),
    db.from('food_logs').select('date').eq('user_id', userId).gte('date', dateCutoff),
    db.from('supplement_logs').select('date').eq('user_id', userId).gte('date', dateCutoff),
    db.from('water_logs').select('date, amount_oz').eq('user_id', userId).gte('date', dateCutoff),
    db.from('health_profile').select('daily_water_target_oz').eq('user_id', userId).maybeSingle(),
    // daily_checkins — the "Did you train today?" answer (date is already local)
    db.from('daily_checkins').select('date, evening_actual_training').eq('user_id', userId).gte('date', dateCutoff),
    // Workout in progress right now, if any — gates today's training credit below
    getLiveSession(db, userId),
  ])

  // Training — a day counts if a FINISHED workout was logged OR the "Did you
  // train today?" check-in was answered that day. Both Yes and No count:
  // answering "No" is a rest day, showing up to the check-in is the point. Only
  // a fully skipped check-in with no logged set fails to count. Same day via
  // both → still one.
  const gymDates = new Set<string>()
  if (gymR.status === 'fulfilled') {
    for (const row of (gymR.value.data ?? []) as Array<{ logged_at: string }>) {
      gymDates.add(formatInTimeZone(new Date(row.logged_at), tz, 'yyyy-MM-dd'))
    }
  }
  const checkinDates = new Set<string>()
  if (checkinR.status === 'fulfilled') {
    for (const row of (checkinR.value.data ?? []) as Array<{ date: string | null; evening_actual_training: boolean | null }>) {
      if (row.date && row.evening_actual_training !== null) checkinDates.add(row.date)
    }
  }

  // A workout only banks the day once it's done — mid-session the day sits
  // "pending" so the streak ticks up when he taps Finish Workout (or when the
  // session goes cold an hour later), not on his first warmup set. Only the day
  // holding the live session can be pending; every earlier day is settled.
  // The check-in is its own path to the day, so an already-answered check-in
  // banks it regardless of the workout still running.
  const live = liveR.status === 'fulfilled' ? liveR.value : null
  let trainingPending = false
  if (live) {
    const liveDay = formatInTimeZone(new Date(live.lastSetAt), tz, 'yyyy-MM-dd')
    if (!checkinDates.has(liveDay)) {
      gymDates.delete(liveDay)
      trainingPending = true
    }
  }
  for (const d of checkinDates) gymDates.add(d)

  // Journal / food / supplements — any row that day counts (date is already local).
  const datesFrom = (r: PromiseSettledResult<{ data: Array<{ date: string | null }> | null }>) => {
    const s = new Set<string>()
    const rows = r.status === 'fulfilled' ? (r.value.data ?? []) : []
    for (const row of rows) if (row.date) s.add(row.date)
    return s
  }
  const journalDates = datesFrom(journalR)
  const foodDates = datesFrom(foodR)
  const suppDates = datesFrom(suppR)

  // Water — a day counts when total oz meets the daily target. If no target is
  // set, any water logged counts.
  const target = profileR.status === 'fulfilled'
    ? ((profileR.value.data as { daily_water_target_oz: number | null } | null)?.daily_water_target_oz ?? null)
    : null
  const waterByDay = new Map<string, number>()
  if (waterR.status === 'fulfilled') {
    for (const row of (waterR.value.data ?? []) as Array<{ date: string; amount_oz: number | null }>) {
      if (!row.date) continue
      waterByDay.set(row.date, (waterByDay.get(row.date) ?? 0) + (row.amount_oz ?? 0))
    }
  }
  const waterDates = new Set<string>()
  for (const [day, total] of waterByDay) {
    if (target ? total >= target : total > 0) waterDates.add(day)
  }

  return {
    training: { ...(gymDates.size ? stat(gymDates, tz) : EMPTY), pending: trainingPending },
    journal: journalDates.size ? stat(journalDates, tz) : EMPTY,
    food: foodDates.size ? stat(foodDates, tz) : EMPTY,
    supplements: suppDates.size ? stat(suppDates, tz) : EMPTY,
    water: waterDates.size ? stat(waterDates, tz) : EMPTY,
  }
}
