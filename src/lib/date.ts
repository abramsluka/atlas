import { formatInTimeZone } from 'date-fns-tz'

/**
 * Returns today's date as YYYY-MM-DD in the user's local timezone.
 * Never call new Date().toISOString().split('T')[0] — that's UTC and will be wrong.
 */
export function toLocalDate(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, 'yyyy-MM-dd')
}

/**
 * Returns a date N days ago as YYYY-MM-DD in the user's local timezone.
 */
export function daysAgoLocal(n: number, timezone: string): string {
  const d = new Date(Date.now() - n * 86400000)
  return formatInTimeZone(d, timezone, 'yyyy-MM-dd')
}
