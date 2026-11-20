import { formatInTimeZone } from 'date-fns-tz'
import { DAY_ROLLOVER_HOUR } from '@/lib/date'
import type { createServiceClient } from '@/lib/supabase/server'
import type { DayPlanData, PlanItem } from '@/features/journal/types'

type DB = ReturnType<typeof createServiceClient>

function shiftDay(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * The days a journal entry counts for. Normally just its own `date`. An entry
 * written after midnight but before the 3 AM rollover is dated to the day
 * that's ending, and ALSO counts for the calendar day that just started, so a
 * 12:35 AM plan covers tonight and tomorrow.
 */
export function journalDaysFor(date: string, createdAt: string, tz: string): string[] {
  const created = new Date(createdAt)
  const hour = Number(formatInTimeZone(created, tz, 'H'))
  const calendarDay = formatInTimeZone(created, tz, 'yyyy-MM-dd')
  return hour < DAY_ROLLOVER_HOUR && calendarDay === shiftDay(date, 1)
    ? [date, calendarDay]
    : [date]
}

export interface DayPlanRow {
  id: string
  date: string
  created_at: string
  plan: PlanItem[] | null
}

/** Newest morning entry that counts for `today` (rows newest first). */
export function pickDayPlan(rows: DayPlanRow[], today: string, tz: string): DayPlanData | null {
  const row = rows.find(r => journalDaysFor(r.date, r.created_at, tz).includes(today))
  return row ? { entryId: row.id, plan: row.plan ?? [] } : null
}

/** Today's Day Plan for the home card: today's morning entry or a late-night carryover. */
export async function fetchDayPlan(db: DB, userId: string, today: string, tz: string): Promise<DayPlanData | null> {
  const { data, error } = await db
    .from('journal_entries')
    .select('id, date, created_at, plan')
    .eq('user_id', userId)
    .eq('kind', 'morning')
    .in('date', [shiftDay(today, -1), today])
    .order('created_at', { ascending: false })
  if (error) throw error
  return pickDayPlan((data ?? []) as DayPlanRow[], today, tz)
}
