import { format, subHours } from 'date-fns'

// Day key with 6am rollover: anything before 6am counts as the previous day.
export function rolledDate(now: Date = new Date()): string {
  const adjusted = now.getHours() < 6 ? subHours(now, 6) : now
  return format(adjusted, 'yyyy-MM-dd')
}
