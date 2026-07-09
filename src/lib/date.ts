import { formatInTimeZone } from 'date-fns-tz'

/**
 * The app-wide day boundary. A "day" runs 3 AM → 3 AM local: anything logged
 * before 3 AM belongs to the previous day (late nights count as the day being
 * lived, not tomorrow). Every daily feature — food, water, supplements,
 * caffeine, journal, check-ins, habits, energy — shares this boundary.
 */
export const DAY_ROLLOVER_HOUR = 3

const ROLLOVER_MS = DAY_ROLLOVER_HOUR * 3600000

/**
 * Returns today's date as YYYY-MM-DD in the user's local timezone, with the
 * 3 AM rollover applied. Never call new Date().toISOString().split('T')[0] —
 * that's UTC and will be wrong.
 */
export function toLocalDate(timezone: string): string {
  return formatInTimeZone(new Date(Date.now() - ROLLOVER_MS), timezone, 'yyyy-MM-dd')
}

/**
 * Returns a date N days ago as YYYY-MM-DD in the user's local timezone, on the
 * same 3 AM rollover as toLocalDate (daysAgoLocal(0, tz) === toLocalDate(tz)).
 */
export function daysAgoLocal(n: number, timezone: string): string {
  const d = new Date(Date.now() - ROLLOVER_MS - n * 86400000)
  return formatInTimeZone(d, timezone, 'yyyy-MM-dd')
}
