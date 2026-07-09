import { format, subHours } from 'date-fns'
import { DAY_ROLLOVER_HOUR } from '@/lib/date'

// Day key on the app-wide rollover (see DAY_ROLLOVER_HOUR): anything before
// 3 AM counts as the previous day. Uses the device clock, so it's for CLIENT
// code only — server code must use toLocalDate(tz) from @/lib/date instead
// (Vercel runs in UTC).
export function rolledDate(now: Date = new Date()): string {
  return format(subHours(now, DAY_ROLLOVER_HOUR), 'yyyy-MM-dd')
}
