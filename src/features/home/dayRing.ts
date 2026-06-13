// Shared day-progress ring math — used by both the list-view DayRing and the
// Atlas HUD's DayArc, so there's one source of truth (spec §7).

const WAKE_HOUR = 8
const SLEEP_HOUR = 24
export const CIRC = 2 * Math.PI * 52

const PALETTE: [number, [number, number, number]][] = [
  [0, [255, 216, 158]],
  [12.5, [255, 205, 121]],
  [25, [255, 227, 143]],
  [37.5, [255, 183, 106]],
  [50, [255, 149, 89]],
  [62.5, [243, 111, 79]],
  [75, [226, 93, 122]],
  [87.5, [123, 91, 176]],
  [100, [47, 58, 102]],
]

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function paletteAt(p: number): [number, number, number] {
  if (p <= PALETTE[0][0]) return PALETTE[0][1]
  const last = PALETTE[PALETTE.length - 1]
  if (p >= last[0]) return last[1]
  for (let i = 0; i < PALETTE.length - 1; i++) {
    const [p0, c0] = PALETTE[i]
    const [p1, c1] = PALETTE[i + 1]
    if (p >= p0 && p <= p1) {
      const t = (p - p0) / (p1 - p0)
      return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)]
    }
  }
  return [255, 255, 255]
}

function toRgb([r, g, b]: [number, number, number]) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
}

function fmtClock(d: Date) {
  let h = d.getHours()
  const m = d.getMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

function fmtRemaining(totalMin: number) {
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  return `${h}h ${m}m`
}

export interface RingState {
  percent: number | null
  stroke: string
  offset: number
  phase: string
  clock: string
  status: string
  remaining: string
}

export function computeRing(): RingState {
  const now = new Date()
  const hrs = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
  const clock = fmtClock(now)

  if (hrs < WAKE_HOUR) {
    return {
      percent: null, stroke: '#4D4B47', offset: CIRC,
      phase: 'SLEEPING', clock,
      status: '😴 Still sleeping',
      remaining: fmtRemaining((WAKE_HOUR - hrs) * 60) + ' until wake-up',
    }
  }
  if (hrs >= SLEEP_HOUR) {
    return {
      percent: 100, stroke: '#E25D7A', offset: 0,
      phase: 'PAST BEDTIME', clock,
      status: '⚠️ Past bedtime',
      remaining: 'Sleep!',
    }
  }

  const pct = ((hrs - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR)) * 100
  let phase: string, status: string
  if (pct < 25) { phase = 'MORNING'; status = '☀️ Morning — fresh start' }
  else if (pct < 50) { phase = 'MIDDAY'; status = '⚡ Midday — keep moving' }
  else if (pct < 75) { phase = 'AFTERNOON'; status = '🔥 Afternoon — push it' }
  else if (pct < 90) { phase = 'EVENING'; status = '⏳ Evening — wrap up' }
  else { phase = 'BEDTIME'; status = '🌙 Bedtime soon' }

  return {
    percent: Math.floor(pct),
    stroke: toRgb(paletteAt(pct)),
    offset: CIRC * (1 - pct / 100),
    phase, clock, status,
    remaining: fmtRemaining((SLEEP_HOUR - hrs) * 60) + ' awake time left',
  }
}
