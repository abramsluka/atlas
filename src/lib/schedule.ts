// Wake / sleep clock times the user sets in Settings (user_settings.wake_time
// / sleep_time). Pure helpers, safe on server and client. Clock strings are
// 'HH:MM' local wall-clock; hours are decimal (22.5 = 10:30pm). A sleep hour
// is expressed in "energy-day" hours, so a bedtime after midnight reads as
// 24+ (12:30am → 24.5) and always sorts after the wake hour.

export interface ScheduleHours {
  wakeHour: number | null
  sleepHour: number | null // > wakeHour when set; may exceed 24
}

export const EMPTY_SCHEDULE: ScheduleHours = { wakeHour: null, sleepHour: null }

// Accepts 'HH:MM' or Postgres' 'HH:MM:SS'; anything else → null.
export function normalizeClock(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(v.trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

export function clockToHour(clock: string | null | undefined): number | null {
  const c = normalizeClock(clock)
  if (!c) return null
  const [h, m] = c.split(':').map(Number)
  return h + m / 60
}

// Resolve stored clock times into hours the ring and energy model can use.
// A bedtime at or before the wake hour is the next morning.
export function scheduleHours(wake: string | null | undefined, sleep: string | null | undefined): ScheduleHours {
  const wakeHour = clockToHour(wake)
  let sleepHour = clockToHour(sleep)
  if (sleepHour != null && sleepHour <= (wakeHour ?? 7)) sleepHour += 24
  return { wakeHour, sleepHour }
}

// 8 → '8:00 AM', 24 → '12:00 AM', 25.5 → '1:30 AM'
export function fmtClockHour(hour: number): string {
  const total = Math.round(hour * 60) % (24 * 60)
  let h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}
