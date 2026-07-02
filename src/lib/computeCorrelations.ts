import type { SupabaseClient } from '@supabase/supabase-js'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import type { OuraData } from '@/features/health/types'

// ─── Public shape ───────────────────────────────────────────────────────────

export type InsightCategory = 'sleep' | 'training' | 'lifestyle' | 'mood'
export type InsightDirection = 'positive' | 'negative' | 'neutral'
export type InsightMagnitude = 'strong' | 'moderate' | 'weak'

export interface Insight {
  id: string                 // stable slug (used for pinning)
  category: InsightCategory
  title: string
  body: string
  dataPoints: number
  direction: InsightDirection
  magnitude: InsightMagnitude
  chartData?: Array<{ label: string; value: number; unit?: string }>
}

const MIN_N = 10

// ─── math helpers ─────────────────────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0
}

function pearson(pairs: Array<{ x: number; y: number }>): number {
  const n = pairs.length
  if (n < 3) return 0
  const mx = mean(pairs.map(p => p.x))
  const my = mean(pairs.map(p => p.y))
  let num = 0, dx = 0, dy = 0
  for (const p of pairs) {
    num += (p.x - mx) * (p.y - my)
    dx += (p.x - mx) ** 2
    dy += (p.y - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : num / den
}

function magFromR(r: number): InsightMagnitude | null {
  const a = Math.abs(r)
  if (a >= 0.5) return 'strong'
  if (a >= 0.35) return 'moderate'
  if (a >= 0.2) return 'weak'
  return null // too weak to surface
}

function magFromEffect(a: number, b: number): InsightMagnitude | null {
  const avg = (Math.abs(a) + Math.abs(b)) / 2
  if (avg === 0) return null
  const rel = Math.abs(a - b) / avg
  if (rel >= 0.25) return 'strong'
  if (rel >= 0.12) return 'moderate'
  if (rel >= 0.05) return 'weak'
  return null
}

function nextDay(d: string): string {
  return formatInTimeZone(new Date(d + 'T12:00:00').getTime() + 86400000, 'UTC', 'yyyy-MM-dd')
}

const round1 = (n: number) => Math.round(n * 10) / 10

// Split pairs at the median x into low/high groups, average y in each.
function medianSplit(pairs: Array<{ x: number; y: number }>): { lo: number; hi: number } | null {
  if (pairs.length < 4) return null
  const sorted = [...pairs].sort((a, b) => a.x - b.x)
  const mid = Math.floor(sorted.length / 2)
  const lo = mean(sorted.slice(0, mid).map(p => p.y))
  const hi = mean(sorted.slice(sorted.length - mid).map(p => p.y))
  return { lo, hi }
}

// ─── row types ────────────────────────────────────────────────────────────────

type OuraRow = { date: string; data: OuraData }
type GymRow = { logged_at: string; weight: number | null; reps: number | null }
type MoodRow = { date: string; mood: number }
type WaterRow = { date: string; amount_oz: number | null }
type CaffeineRow = { date: string; amount_mg: number | null; logged_at: string | null }

// ─── main ─────────────────────────────────────────────────────────────────────

export async function computeCorrelations(
  db: SupabaseClient,
  userId: string,
  tz: string,
): Promise<Insight[]> {
  const since = formatInTimeZone(subDays(new Date(), 90), tz, 'yyyy-MM-dd')
  const sinceIso = subDays(new Date(), 90).toISOString()

  const [ouraRes, gymRes, moodRes, waterRes, caffeineRes] = await Promise.all([
    db.from('wearable_data').select('date, data').eq('user_id', userId).eq('provider', 'oura').gte('date', since).order('date'),
    db.from('gym_logs').select('logged_at, weight, reps').eq('user_id', userId).gte('logged_at', sinceIso),
    db.from('journal_entries').select('date, mood').eq('user_id', userId).not('mood', 'is', null).gte('date', since),
    db.from('water_logs').select('date, amount_oz').eq('user_id', userId).gte('date', since),
    db.from('caffeine_logs').select('date, amount_mg, logged_at').eq('user_id', userId).gte('date', since),
  ])

  const oura = (ouraRes.data ?? []) as OuraRow[]
  const gym = (gymRes.data ?? []) as GymRow[]
  const moods = (moodRes.data ?? []) as MoodRow[]
  const water = (waterRes.data ?? []) as WaterRow[]
  const caffeine = (caffeineRes.data ?? []) as CaffeineRow[]

  // ── per-date maps ──
  const localDate = (iso: string) => formatInTimeZone(new Date(iso), tz, 'yyyy-MM-dd')

  interface Sleep { score?: number; hrv?: number; totalMin?: number; deepMin?: number; latencyMin?: number; restingHr?: number; readiness?: number }
  const sleepByDate = new Map<string, Sleep>()
  for (const row of oura) {
    const s = row.data?.sleep, r = row.data?.readiness
    sleepByDate.set(row.date, {
      score: s?.score ?? undefined,
      hrv: s?.average_hrv ?? undefined,
      totalMin: s?.total_sleep_duration != null ? s.total_sleep_duration / 60 : undefined,
      deepMin: s?.deep_sleep_duration != null ? s.deep_sleep_duration / 60 : undefined,
      latencyMin: s?.latency != null ? s.latency / 60 : undefined,
      restingHr: s?.resting_heart_rate ?? undefined,
      readiness: r?.score ?? undefined,
    })
  }

  const volumeByDate = new Map<string, number>()
  const trainedDates = new Set<string>()
  for (const g of gym) {
    const d = localDate(g.logged_at)
    trainedDates.add(d)
    volumeByDate.set(d, (volumeByDate.get(d) ?? 0) + (g.weight ?? 0) * (g.reps ?? 0))
  }

  const moodByDate = new Map<string, number>()
  for (const m of moods) moodByDate.set(m.date, m.mood)

  const waterByDate = new Map<string, number>()
  for (const w of water) waterByDate.set(w.date, (waterByDate.get(w.date) ?? 0) + (w.amount_oz ?? 0))

  const caffeineMgByDate = new Map<string, number>()
  const lateCaffeineDates = new Set<string>()
  for (const c of caffeine) {
    caffeineMgByDate.set(c.date, (caffeineMgByDate.get(c.date) ?? 0) + (c.amount_mg ?? 0))
    if (c.logged_at) {
      const hour = Number(formatInTimeZone(new Date(c.logged_at), tz, 'H'))
      if (hour >= 14) lateCaffeineDates.add(c.date)
    }
  }

  const insights: Insight[] = []
  const sleepDates = Array.from(sleepByDate.keys()).sort()

  // ── helper: push a Pearson-based insight with a median-split mini chart ──
  function pushPearson(opts: {
    id: string; category: InsightCategory; pairs: Array<{ x: number; y: number }>
    title: string; body: (r: number, n: number, lo: number, hi: number) => string
    loLabel: string; hiLabel: string; unit?: string
  }) {
    const { pairs } = opts
    if (pairs.length < MIN_N) return
    const r = pearson(pairs)
    const mag = magFromR(r)
    if (!mag) return
    const split = medianSplit(pairs)
    if (!split) return
    insights.push({
      id: opts.id, category: opts.category, title: opts.title,
      body: opts.body(r, pairs.length, split.lo, split.hi),
      dataPoints: pairs.length,
      direction: r > 0 ? 'positive' : 'negative',
      magnitude: mag,
      chartData: [
        { label: opts.loLabel, value: round1(split.lo), unit: opts.unit },
        { label: opts.hiLabel, value: round1(split.hi), unit: opts.unit },
      ],
    })
  }

  // ── helper: push a binned (group A vs group B) insight ──
  function pushBinned(opts: {
    id: string; category: InsightCategory; a: number[]; b: number[]
    title: string; aLabel: string; bLabel: string; unit?: string
    body: (aAvg: number, bAvg: number, n: number) => string
    positiveWhenBHigher?: boolean
  }) {
    const { a, b } = opts
    if (a.length < 4 || b.length < 4 || a.length + b.length < MIN_N) return
    const aAvg = mean(a), bAvg = mean(b)
    const mag = magFromEffect(aAvg, bAvg)
    if (!mag) return
    const bHigher = bAvg > aAvg
    const direction: InsightDirection = (opts.positiveWhenBHigher ? bHigher : !bHigher) ? 'positive' : 'negative'
    insights.push({
      id: opts.id, category: opts.category, title: opts.title,
      body: opts.body(aAvg, bAvg, a.length + b.length),
      dataPoints: a.length + b.length,
      direction, magnitude: mag,
      chartData: [
        { label: opts.aLabel, value: round1(aAvg), unit: opts.unit },
        { label: opts.bLabel, value: round1(bAvg), unit: opts.unit },
      ],
    })
  }

  // ═══ SLEEP → RECOVERY ═══════════════════════════════════════════════════════

  // Sleep latency → next-day HRV (fast <15min vs slow >30min)
  {
    const fast: number[] = [], slow: number[] = []
    for (const d of sleepDates) {
      const lat = sleepByDate.get(d)?.latencyMin
      const nextHrv = sleepByDate.get(nextDay(d))?.hrv
      if (lat == null || nextHrv == null) continue
      if (lat < 15) fast.push(nextHrv)
      else if (lat > 30) slow.push(nextHrv)
    }
    pushBinned({
      id: 'sleep_latency_hrv', category: 'sleep', a: slow, b: fast,
      title: 'Falling asleep fast → higher HRV', aLabel: 'Slow (>30m)', bLabel: 'Fast (<15m)', unit: 'ms',
      positiveWhenBHigher: true,
      body: (slowAvg, fastAvg, n) => `When you fall asleep in under 15 min, next-day HRV averages ${round1(fastAvg)}ms vs ${round1(slowAvg)}ms on nights it takes over 30 min.`,
    })
  }

  // Total sleep duration → next-day readiness
  pushPearson({
    id: 'sleep_duration_readiness', category: 'sleep',
    pairs: sleepDates.flatMap(d => {
      const t = sleepByDate.get(d)?.totalMin, r = sleepByDate.get(nextDay(d))?.readiness
      return t != null && r != null ? [{ x: t, y: r }] : []
    }),
    title: 'More sleep → better readiness', loLabel: 'Less sleep', hiLabel: 'More sleep',
    body: (r, n, lo, hi) => `On your better-slept nights, next-day readiness averages ${Math.round(hi)} vs ${Math.round(lo)} after shorter nights.`,
  })

  // Deep sleep → next-day resting HR
  pushPearson({
    id: 'deep_sleep_resting_hr', category: 'sleep',
    pairs: sleepDates.flatMap(d => {
      const deep = sleepByDate.get(d)?.deepMin, hr = sleepByDate.get(nextDay(d))?.restingHr
      return deep != null && hr != null ? [{ x: deep, y: hr }] : []
    }),
    title: 'Deep sleep → lower resting HR', loLabel: 'Less deep', hiLabel: 'More deep', unit: 'bpm',
    body: (r, n, lo, hi) => `More deep sleep tracks with a ${r < 0 ? 'lower' : 'higher'} next-day resting HR (${Math.round(hi)} vs ${Math.round(lo)} bpm across the range).`,
  })

  // Sleep score → next-day training volume
  pushPearson({
    id: 'sleep_score_volume', category: 'sleep',
    pairs: sleepDates.flatMap(d => {
      const sc = sleepByDate.get(d)?.score
      if (sc == null) return []
      const vol = volumeByDate.get(nextDay(d)) ?? 0
      return [{ x: sc, y: vol }]
    }),
    title: 'Sleep score → next-day training volume', loLabel: 'Low score', hiLabel: 'High score', unit: 'lb',
    body: (r, n, lo, hi) => `After higher sleep scores you log ${Math.round(hi).toLocaleString()} lb of volume on average vs ${Math.round(lo).toLocaleString()} lb after poor nights.`,
  })

  // ═══ TRAINING → RECOVERY ════════════════════════════════════════════════════

  // Training volume → next-day readiness
  pushPearson({
    id: 'volume_readiness', category: 'training',
    pairs: sleepDates.flatMap(d => {
      const vol = volumeByDate.get(d)
      const r = sleepByDate.get(nextDay(d))?.readiness
      return vol != null && vol > 0 && r != null ? [{ x: vol, y: r }] : []
    }),
    title: 'Training volume → next-day readiness', loLabel: 'Lighter', hiLabel: 'Heavier',
    body: (r, n, lo, hi) => `After your heavier sessions, next-day readiness averages ${Math.round(hi)} vs ${Math.round(lo)} after lighter ones.`,
  })

  // Days since last workout → HRV (does rest help?)
  {
    const sortedTrained = Array.from(trainedDates).sort()
    const pairs: Array<{ x: number; y: number }> = []
    for (const d of sleepDates) {
      const hrv = sleepByDate.get(d)?.hrv
      if (hrv == null) continue
      // days since most recent training day on or before d
      let last: string | null = null
      for (const t of sortedTrained) { if (t <= d) last = t; else break }
      if (!last) continue
      const gap = Math.round((new Date(d + 'T12:00:00').getTime() - new Date(last + 'T12:00:00').getTime()) / 86400000)
      if (gap >= 0 && gap <= 6) pairs.push({ x: gap, y: hrv })
    }
    pushPearson({
      id: 'rest_days_hrv', category: 'training', pairs,
      title: 'Does rest lift your HRV?', loLabel: 'Fewer rest days', hiLabel: 'More rest days', unit: 'ms',
      body: (r, n, lo, hi) => r > 0
        ? `HRV trends up the longer it's been since you trained (${round1(hi)}ms after more rest vs ${round1(lo)}ms).`
        : `HRV doesn't drop with training — it's ${round1(lo)}ms fresh vs ${round1(hi)}ms after several rest days.`,
    })
  }

  // Most consistent training weekday
  {
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const total = new Array(7).fill(0), trained = new Array(7).fill(0)
    // build the day window from sleep+training coverage (last 90 local days)
    for (let i = 89; i >= 0; i--) {
      const d = formatInTimeZone(subDays(new Date(), i), tz, 'yyyy-MM-dd')
      const dow = new Date(d + 'T12:00:00').getDay()
      total[dow]++
      if (trainedDates.has(d)) trained[dow]++
    }
    const totalTrained = trained.reduce((a, b) => a + b, 0)
    if (totalTrained >= MIN_N) {
      const pct = total.map((t, i) => (t > 0 ? (trained[i] / t) * 100 : 0))
      let best = 0, worst = 0
      for (let i = 1; i < 7; i++) { if (pct[i] > pct[best]) best = i; if (pct[i] < pct[worst]) worst = i }
      insights.push({
        id: 'consistent_weekday', category: 'training',
        title: `${DOW[best]} is your most reliable training day`,
        body: `You train ${Math.round(pct[best])}% of ${DOW[best]}s and only ${Math.round(pct[worst])}% of ${DOW[worst]}s over the last 12 weeks.`,
        dataPoints: totalTrained, direction: 'neutral', magnitude: 'moderate',
        chartData: DOW.map((d, i) => ({ label: d, value: Math.round(pct[i]), unit: '%' })),
      })
    }
  }

  // ═══ LIFESTYLE → SLEEP ══════════════════════════════════════════════════════

  // Caffeine after 2pm → sleep latency that night
  {
    const withLate: number[] = [], without: number[] = []
    for (const d of sleepDates) {
      const lat = sleepByDate.get(d)?.latencyMin
      if (lat == null) continue
      if (caffeineMgByDate.has(d) || lateCaffeineDates.has(d)) {
        if (lateCaffeineDates.has(d)) withLate.push(lat)
        else without.push(lat)
      } else {
        without.push(lat)
      }
    }
    pushBinned({
      id: 'late_caffeine_latency', category: 'lifestyle', a: without, b: withLate,
      title: 'Late caffeine → slower to fall asleep', aLabel: 'None after 2pm', bLabel: 'Caffeine after 2pm', unit: 'min',
      positiveWhenBHigher: false,
      body: (noAvg, lateAvg, n) => `On days you have caffeine after 2pm, sleep latency averages ${round1(lateAvg)} min vs ${round1(noAvg)} min otherwise.`,
    })
  }

  // Total daily caffeine → sleep score (same night)
  pushPearson({
    id: 'caffeine_sleep_score', category: 'lifestyle',
    pairs: sleepDates.flatMap(d => {
      const mg = caffeineMgByDate.get(d)
      const sc = sleepByDate.get(d)?.score
      return mg != null && sc != null ? [{ x: mg, y: sc }] : []
    }),
    title: 'Caffeine load → sleep score', loLabel: 'Less caffeine', hiLabel: 'More caffeine',
    body: (r, n, lo, hi) => `On higher-caffeine days your sleep score averages ${Math.round(hi)} vs ${Math.round(lo)} on lighter days.`,
  })

  // Water intake → next-day HRV
  pushPearson({
    id: 'water_hrv', category: 'lifestyle',
    pairs: sleepDates.flatMap(d => {
      const w = waterByDate.get(d)
      const hrv = sleepByDate.get(nextDay(d))?.hrv
      return w != null && w > 0 && hrv != null ? [{ x: w, y: hrv }] : []
    }),
    title: 'Hydration → next-day HRV', loLabel: 'Less water', hiLabel: 'More water', unit: 'ms',
    body: (r, n, lo, hi) => `On your best-hydrated days, next-day HRV averages ${round1(hi)}ms vs ${round1(lo)}ms.`,
  })

  // ═══ MOOD ═══════════════════════════════════════════════════════════════════

  // Mood on trained vs rest days
  {
    const trained: number[] = [], rest: number[] = []
    for (const [d, m] of moodByDate) {
      if (trainedDates.has(d)) trained.push(m); else rest.push(m)
    }
    pushBinned({
      id: 'mood_training', category: 'mood', a: rest, b: trained,
      title: 'Training days feel better', aLabel: 'Rest days', bLabel: 'Trained', unit: '/5',
      positiveWhenBHigher: true,
      body: (restAvg, trainedAvg, n) => `Your mood averages ${round1(trainedAvg)}/5 on days you train vs ${round1(restAvg)}/5 on rest days.`,
    })
  }

  // Mood vs previous-night sleep score
  pushPearson({
    id: 'mood_prev_sleep', category: 'mood',
    pairs: Array.from(moodByDate.entries()).flatMap(([d, m]) => {
      // previous night's sleep score is the oura row dated the day before
      const prev = formatInTimeZone(new Date(d + 'T12:00:00').getTime() - 86400000, 'UTC', 'yyyy-MM-dd')
      const sc = sleepByDate.get(prev)?.score
      return sc != null ? [{ x: sc, y: m }] : []
    }),
    title: 'Sleep last night → mood today', loLabel: 'Poor sleep', hiLabel: 'Good sleep', unit: '/5',
    body: (r, n, lo, hi) => `After good sleep your mood averages ${round1(hi)}/5 vs ${round1(lo)}/5 after poor nights.`,
  })

  // Strongest first within each category
  const order: InsightMagnitude[] = ['strong', 'moderate', 'weak']
  insights.sort((a, b) => order.indexOf(a.magnitude) - order.indexOf(b.magnitude))

  return insights
}
