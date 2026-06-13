'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTodayCheckin } from '@/features/workouts/queries'
import { useSaveEveningCheckin } from '@/features/workouts/mutations'
import type { DailyCheckin } from '@/features/workouts/types'
import type { ActivitySnapshot } from '@/features/mentor/types'
import type { BentoStats } from '@/app/api/home/bento-stats/route'

// ─── Day Ring ────────────────────────────────────────────────────────────────

const WAKE_HOUR  = 8
const SLEEP_HOUR = 24
const CIRC = 2 * Math.PI * 52

const PALETTE: [number, [number, number, number]][] = [
  [0,    [255, 216, 158]],
  [12.5, [255, 205, 121]],
  [25,   [255, 227, 143]],
  [37.5, [255, 183, 106]],
  [50,   [255, 149,  89]],
  [62.5, [243, 111,  79]],
  [75,   [226,  93, 122]],
  [87.5, [123,  91, 176]],
  [100,  [ 47,  58, 102]],
]

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

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

interface RingState {
  percent: number | null
  stroke: string
  offset: number
  phase: string
  clock: string
  status: string
  remaining: string
}

function computeRing(): RingState {
  const now  = new Date()
  const hrs  = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
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

  const pct = (hrs - WAKE_HOUR) / (SLEEP_HOUR - WAKE_HOUR) * 100
  let phase: string, status: string
  if      (pct < 25) { phase = 'MORNING';   status = '☀️ Morning — fresh start' }
  else if (pct < 50) { phase = 'MIDDAY';    status = '⚡ Midday — keep moving'  }
  else if (pct < 75) { phase = 'AFTERNOON'; status = '🔥 Afternoon — push it'   }
  else if (pct < 90) { phase = 'EVENING';   status = '⏳ Evening — wrap up'     }
  else               { phase = 'BEDTIME';   status = '🌙 Bedtime soon'          }

  return {
    percent: Math.floor(pct),
    stroke: toRgb(paletteAt(pct)),
    offset: CIRC * (1 - pct / 100),
    phase, clock, status,
    remaining: fmtRemaining((SLEEP_HOUR - hrs) * 60) + ' awake time left',
  }
}

function DayRing() {
  const [ring, setRing] = useState<RingState | null>(null)
  useEffect(() => {
    setRing(computeRing())
    const id = setInterval(() => setRing(computeRing()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-wrap items-center justify-center gap-[26px] p-[22px] mb-[18px] cosmic-card">
      <div className="relative w-[168px] h-[168px] max-[480px]:w-[144px] max-[480px]:h-[144px] flex-shrink-0">
        <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', display: 'block' }}>
          <defs>
            <filter id="drGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.4" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
          <circle
            cx="60" cy="60" r="52" fill="none"
            stroke={ring?.stroke ?? '#4D4B47'} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={ring?.offset ?? CIRC}
            filter="url(#drGlow)"
            style={{
              transform: 'rotate(-90deg)', transformOrigin: '60px 60px',
              transition: 'stroke 0.7s cubic-bezier(0.22,1,0.36,1), stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[40px] font-extrabold tabular-nums tracking-[-0.04em] leading-none text-white">
            {ring === null ? '—' : ring.percent === null ? '—' : `${ring.percent}%`}
          </span>
          <span className="mt-[5px] font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
            {ring?.phase ?? ''}
          </span>
          <span className="font-mono text-[10.5px] text-zinc-500 mt-0.5">{ring?.clock ?? ''}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <div className="text-[14px] font-bold text-white">{ring?.status ?? ''}</div>
        <div className="font-mono text-[12px] text-zinc-400">{ring?.remaining ?? ''}</div>
        <div className="font-mono text-[11px] text-zinc-500">8:00 AM – 12:00 AM</div>
      </div>
    </div>
  )
}

// ─── Goal Ticker ──────────────────────────────────────────────────────────────

interface TickerItem { status: 'done' | 'pending' | 'empty'; text: string }

function buildTickerItems(checkin: DailyCheckin | null | undefined): TickerItem[] {
  if (!checkin || checkin.evening_actual_training === null || checkin.evening_actual_training === undefined) {
    return [{ status: 'pending', text: 'Daily check-in pending' }]
  }
  const text = checkin.evening_actual_training
    ? (checkin.evening_reflection ? `Trained — ${checkin.evening_reflection}` : 'Trained today ✓')
    : 'Rest day ✓'
  return [{ status: 'done', text }]
}

function statusGlyph(s: TickerItem['status']) {
  return s === 'done' ? '✓' : s === 'pending' ? '○' : '·'
}

function GoalTicker({ checkin }: { checkin: DailyCheckin | null | undefined }) {
  const items  = buildTickerItems(checkin)
  const done   = items.filter(i => i.status === 'done').length
  const total  = items.length

  const [cur,  setCur]  = useState(0)
  const [prev, setPrev] = useState<number | null>(null)
  const pendingT = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setCur(0)
    setPrev(null)
    if (pendingT.current) clearTimeout(pendingT.current)
  }, [checkin])

  useEffect(() => {
    if (items.length <= 1) return
    const id = setInterval(() => {
      const next = (cur + 1) % items.length
      setPrev(cur)
      setCur(next)
      if (pendingT.current) clearTimeout(pendingT.current)
      pendingT.current = setTimeout(() => setPrev(null), 460)
    }, 5000)
    return () => clearInterval(id)
  }, [cur, items.length])

  const curItem  = items[Math.min(cur, items.length - 1)]
  const prevItem = prev !== null ? items[Math.min(prev, items.length - 1)] : null

  const allDone  = done === total && total > 0
  const dotColor = allDone ? '#6BE3A4' : '#F2C063'
  const dotGlow  = allDone ? '0 0 8px rgba(107,227,164,0.7)' : '0 0 8px rgba(242,192,99,0.7)'

  return (
    <div
      className="relative overflow-hidden flex items-center gap-[10px] px-3 py-[7px] rounded-xl mb-[18px]"
      style={{
        background: 'linear-gradient(180deg,rgba(0,0,0,0.42) 0%,rgba(0,0,0,0.30) 100%), repeating-linear-gradient(0deg,rgba(255,255,255,0.025) 0,rgba(255,255,255,0.025) 1px,transparent 1px,transparent 3px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div className="absolute top-0 bottom-0 w-[30%] pointer-events-none"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)', animation: 'ticker-sweep 8s linear infinite' }} />

      <span className="w-[7px] h-[7px] rounded-full flex-shrink-0 animate-led-pulse"
        style={{ background: dotColor, boxShadow: dotGlow }} />

      <span className="font-mono text-[9.5px] font-extrabold tracking-[0.18em] text-zinc-600 uppercase flex-shrink-0">
        CHECKINS
      </span>

      <div className="relative overflow-hidden flex-1 h-[22px]">
        {prevItem && (
          <div className="absolute inset-0 flex items-center gap-2 font-mono text-[12.5px] font-semibold tabular-nums text-white whitespace-nowrap is-leaving">
            <span className="inline-flex justify-center w-[18px]"
              style={{ color: prevItem.status === 'done' ? '#6BE3A4' : 'rgba(255,255,255,0.4)' }}>
              {statusGlyph(prevItem.status)}
            </span>
            <span className="flex-1 overflow-hidden text-ellipsis">{prevItem.text}</span>
          </div>
        )}
        <div className={`absolute inset-0 flex items-center gap-2 font-mono text-[12.5px] font-semibold tabular-nums text-white whitespace-nowrap ${prevItem ? 'is-entering' : ''}`}>
          <span className="inline-flex justify-center w-[18px]"
            style={{ color: curItem.status === 'done' ? '#6BE3A4' : 'rgba(255,255,255,0.4)' }}>
            {statusGlyph(curItem.status)}
          </span>
          <span className="flex-1 overflow-hidden text-ellipsis">{curItem.text}</span>
        </div>
      </div>

      <span className="font-mono text-[11px] font-bold tracking-[0.04em] tabular-nums text-zinc-400 px-2 py-[3px] rounded-full flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.04)' }}>
        {done}/{total}
      </span>
    </div>
  )
}

// ─── Bento Grid ───────────────────────────────────────────────────────────────

function fmtRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function moodEmoji(mood: number | null): string {
  if (mood === null) return ''
  return ['', '😞', '😐', '🙂', '😊', '😄'][mood] ?? ''
}

interface BentoCardProps {
  href: string
  color: string
  label: string
  headline: string
  sub?: string
  wide?: boolean
  loading?: boolean
  dim?: boolean
}

function BentoCard({ href, color, label, headline, sub, wide, loading, dim }: BentoCardProps) {
  const router = useRouter()
  return (
    <motion.button
      onClick={() => router.push(href)}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={`text-left flex flex-col justify-between p-4 rounded-2xl relative overflow-hidden ${wide ? 'col-span-2' : ''}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderLeft: `2px solid ${dim ? 'rgba(255,255,255,0.08)' : color}`,
        minHeight: wide ? 76 : 92,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {/* Subtle color wash behind content */}
      {!dim && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 0% 50%, ${color}0a 0%, transparent 65%)` }}
        />
      )}

      <div className="relative">
        <span
          className="text-[9px] font-extrabold tracking-[0.22em] uppercase"
          style={{ color: dim ? 'rgba(255,255,255,0.25)' : color }}
        >
          {label}
        </span>
      </div>

      <div className="relative mt-1.5">
        {loading ? (
          <div className="h-4 w-3/4 rounded bg-white/[0.06] animate-pulse" />
        ) : (
          <span className="text-[13px] font-bold text-white leading-snug">{headline}</span>
        )}
        {sub && !loading && (
          <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{sub}</p>
        )}
      </div>
    </motion.button>
  )
}

function BentoGrid() {
  const [stats, setStats] = useState<BentoStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/home/bento-stats')
      .then(r => r.json())
      .then((d: BentoStats) => { setStats(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  // Train
  const trainHeadline = stats?.lastWorkout?.name ?? (loading ? '' : 'No workout logged')
  const trainSub = stats?.lastWorkout
    ? `${fmtRelTime(stats.lastWorkout.completedAt)} · ${stats.workoutCount7d}x this week`
    : stats ? `${stats.workoutCount7d} workouts this week` : ''
  const trainDim = !loading && !stats?.lastWorkout && (stats?.workoutCount7d ?? 0) === 0

  // Fuel
  const fuelHeadline = stats
    ? stats.todayCalories > 0 ? `${stats.todayCalories} cal` : 'Nothing logged'
    : ''
  const fuelSub = stats?.todayProtein ? `${stats.todayProtein}g protein` : ''
  const fuelDim = !loading && (stats?.todayCalories ?? 0) === 0

  // Vitals
  const vitalsHeadline = stats?.recoveryScore != null
    ? `${stats.recoveryScore} recovery`
    : stats?.sleepScore != null
    ? `${stats.sleepScore} sleep`
    : loading ? '' : 'No device'
  const vitalsSub = stats?.sleepScore != null && stats?.recoveryScore != null
    ? `${stats.sleepScore} sleep score`
    : ''
  const vitalsDim = !loading && stats?.recoveryScore == null && stats?.sleepScore == null

  // Journal
  const journalEntry = stats?.lastJournal
  const journalHeadline = journalEntry
    ? journalEntry.snippet || 'Entry logged'
    : loading ? '' : 'Nothing written'
  const journalSub = journalEntry
    ? `${fmtRelTime(journalEntry.createdAt)}${journalEntry.mood ? ' · ' + moodEmoji(journalEntry.mood) : ''}`
    : ''
  const journalDim = !loading && !journalEntry

  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <BentoCard
        href="/gym"
        color="#4ade80"
        label="Train"
        headline={trainHeadline}
        sub={trainSub}
        loading={loading}
        dim={trainDim}
      />
      <BentoCard
        href="/health"
        color="#22d3ee"
        label="Fuel"
        headline={fuelHeadline}
        sub={fuelSub}
        loading={loading}
        dim={fuelDim}
      />
      <BentoCard
        href="/health"
        color="#a78bfa"
        label="Vitals"
        headline={vitalsHeadline}
        sub={vitalsSub}
        loading={loading}
        dim={vitalsDim}
      />
      <BentoCard
        href="/health/caffeine"
        color="#fb923c"
        label="Energy"
        headline="See energy curve"
        sub="Caffeine · circadian · meals"
        loading={false}
        dim={false}
      />
      <BentoCard
        href="/journal"
        color="#fbbf24"
        label="Journal"
        headline={journalHeadline}
        sub={journalSub}
        loading={loading}
        dim={journalDim}
        wide
      />
    </div>
  )
}

// ─── Section Title ────────────────────────────────────────────────────────────

function SectionTitle({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-[18px] h-px bg-zinc-600" style={{ opacity: 0.6 }} />
      <span className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-zinc-600">{label}</span>
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
    </div>
  )
}

// ─── Daily Check-in ───────────────────────────────────────────────────────────

function DailyCheckinCard({ today, checkin }: { today: string; checkin: DailyCheckin | null }) {
  const [notes, setNotes] = useState('')
  const mutation = useSaveEveningCheckin(today)

  if (checkin?.evening_actual_training !== null && checkin?.evening_actual_training !== undefined) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: '1.25rem',
      }}>
        <p className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-zinc-600 mb-2">Daily check-in</p>
        <p className="text-lg font-semibold text-white">
          {checkin.evening_actual_training ? '✓ Trained today' : '✓ Rest day'}
        </p>
        {checkin.evening_reflection && (
          <p className="mt-1 text-sm text-zinc-400">{checkin.evening_reflection}</p>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 16,
      padding: '1.25rem',
    }}>
      <p className="mb-4 text-lg font-semibold text-white">Did you train today?</p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="What'd you do? (optional)"
        rows={2}
        className="mb-4 w-full resize-none rounded-xl bg-black/30 border border-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/20"
      />
      <div className="flex gap-3">
        <button
          onClick={() => mutation.mutate({ trained: true, reflection: notes || undefined })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl text-base font-semibold text-black disabled:opacity-50 active:opacity-80"
          style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55),0 4px 14px rgba(0,0,0,0.40)' }}
        >
          Yes
        </button>
        <button
          onClick={() => mutation.mutate({ trained: false, reflection: notes || undefined })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white/[0.06] border border-white/[0.08] text-base font-semibold text-white disabled:opacity-50 active:opacity-80"
        >
          No
        </button>
      </div>
      {mutation.error && <p className="mt-2 text-sm text-red-400">{String(mutation.error)}</p>}
    </div>
  )
}

// ─── Today's Call ─────────────────────────────────────────────────────────────

type Verdict = 'GREEN' | 'YELLOW' | 'RED'
interface TodaysCallData { color: Verdict; headline: string; bullets: string[] }

const VERDICT_COLOR: Record<Verdict, string> = {
  GREEN:  '#4ade80',
  YELLOW: '#fbbf24',
  RED:    '#f87171',
}
const VERDICT_BORDER: Record<Verdict, string> = {
  GREEN:  'rgba(74,222,128,0.25)',
  YELLOW: 'rgba(251,191,36,0.25)',
  RED:    'rgba(248,113,113,0.25)',
}

function TodaysCallCard() {
  const [data, setData] = useState<TodaysCallData | null>(null)
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)
  const fetched = useRef(false)

  const fetch_ = useCallback(async () => {
    if (loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/home/todays-call', { method: 'POST' })
      if (!res.ok) return
      const json = await res.json()
      if (json.noData) { setNoData(true); return }
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [loading])

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    fetch_()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (noData) return null
  if (!data && !loading) return null

  const color = data ? VERDICT_COLOR[data.color] : 'rgba(255,255,255,0.2)'
  const border = data ? VERDICT_BORDER[data.color] : 'rgba(255,255,255,0.08)'

  return (
    <div
      className="rounded-2xl p-5 mb-4"
      style={{ background: '#0e0e10', border: `1px solid ${border}`, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/40">Today&apos;s Call</span>
        {data ? (
          <span
            className="text-[11px] font-bold tracking-widest px-2 py-0.5 rounded-full"
            style={{ color, background: `${color}18` }}
          >
            {data.color}
          </span>
        ) : (
          <span className="text-[11px] text-white/20 animate-pulse">Loading…</span>
        )}
      </div>

      {data ? (
        <>
          <p className="text-sm font-semibold text-white leading-snug mb-3">{data.headline}</p>
          <ul className="space-y-1">
            {data.bullets.map((b, i) => (
              <li key={i} className="text-xs text-white/50 leading-relaxed">{b}</li>
            ))}
          </ul>
        </>
      ) : (
        <div className="space-y-2">
          <div className="h-4 rounded bg-white/[0.06] animate-pulse w-3/4" />
          <div className="h-3 rounded bg-white/[0.04] animate-pulse w-1/2" />
          <div className="h-3 rounded bg-white/[0.04] animate-pulse w-2/3" />
        </div>
      )}
    </div>
  )
}

// ─── Briefing Card ────────────────────────────────────────────────────────────

function BriefingCard() {
  const [coachText, setCoachText] = useState('')
  const [coachStreaming, setCoachStreaming] = useState(false)

  async function streamBriefing() {
    if (coachStreaming) return
    setCoachStreaming(true)
    setCoachText('')
    try {
      const res = await fetch('/api/home/coach', { method: 'POST' })
      if (!res.ok || !res.body) {
        setCoachText('Something went wrong. Try again.')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        setCoachText(prev => prev + decoder.decode(value))
      }
    } finally {
      setCoachStreaming(false)
    }
  }

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16,
        padding: '1.25rem',
      }}
    >
      <p className="text-lg font-semibold text-white mb-2">Your briefing</p>
      {!coachText && !coachStreaming && (
        <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
          Get a read on where you stand across everything — gym, habits, health, journal.
        </p>
      )}
      {coachText && (
        <p className="text-sm text-zinc-300 leading-relaxed mb-4 whitespace-pre-wrap">
          {coachText}
          {coachStreaming && (
            <span className="inline-block w-[2px] h-[14px] bg-zinc-400 ml-0.5 align-middle animate-pulse" />
          )}
        </p>
      )}
      {!coachText && coachStreaming && (
        <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
          Reading your data
          <span className="inline-block w-[2px] h-[14px] bg-zinc-400 ml-0.5 align-middle animate-pulse" />
        </p>
      )}
      <button
        onClick={streamBriefing}
        disabled={coachStreaming}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold disabled:opacity-50 active:opacity-80"
        style={{
          background: coachStreaming
            ? 'rgba(255,255,255,0.08)'
            : 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)',
          boxShadow: coachStreaming ? 'none' : 'inset 0 1px 0 rgba(255,255,255,0.55),0 4px 14px rgba(0,0,0,0.40)',
          color: coachStreaming ? '#71717a' : '#000',
        }}
      >
        {coachStreaming ? 'Reading your data…' : coachText ? 'Refresh briefing' : 'Get my briefing'}
      </button>
    </div>
  )
}

// ─── Cosmic Map ───────────────────────────────────────────────────────────────

interface MapNode {
  id: string
  label: string
  href: string
  color: string
  glowColor: string
  radius: number
  size: number
  period: number
  angle: number
}

const MAP_NODES: MapNode[] = [
  { id: 'gym',    label: 'Gym',    href: '/gym',    color: '#4ade80', glowColor: '#4ade80', radius: 135, size: 48, period: 25, angle: 0   },
  { id: 'health', label: 'Health', href: '/health', color: '#22d3ee', glowColor: '#22d3ee', radius: 180, size: 44, period: 32, angle: 72  },
  { id: 'journal',label: 'Journal',href: '/journal',color: '#fbbf24', glowColor: '#fbbf24', radius: 120, size: 42, period: 20, angle: 144 },
  { id: 'mentor', label: 'Mentor', href: '/mentor', color: '#a3e635', glowColor: '#a3e635', radius: 210, size: 52, period: 38, angle: 216 },
  { id: 'home',   label: 'Today',  href: '/',       color: '#f4f4f5', glowColor: '#ffffff', radius: 100, size: 38, period: 15, angle: 288 },
]

function CosmicMap({ activity }: { activity: ActivitySnapshot | null }) {
  const router = useRouter()
  const [entered, setEntered] = useState(false)
  const systemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 50)
    return () => clearTimeout(t)
  }, [])

  // B3 — Ambient precession via RAF, zero React re-renders
  useEffect(() => {
    let raf: number
    const tick = () => {
      if (systemRef.current) {
        const prec = Math.sin(Date.now() / 8000) * 3
        systemRef.current.style.transform = `rotateX(15deg) rotateZ(${prec}deg)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  function glowIntensity(nodeId: string): number {
    if (!activity) return 0.3
    const count = activity[nodeId as keyof ActivitySnapshot] ?? 0
    if (count === 0) return 0.15
    if (count >= 5) return 0.9
    return 0.3 + count * 0.12
  }

  // B4 — 180 stable stars, ~20% with slow CSS drift
  const stars = useRef(
    Array.from({ length: 180 }, (_, i) => ({
      x: ((i * 137.508) % 100),
      y: ((i * 79.379) % 100),
      size: i % 9 === 0 ? 2.5 : i % 4 === 0 ? 1.8 : 1,
      opacity: 0.04 + (i % 11) * 0.04,
      drift: i % 5 === 0,
      driftDuration: 18 + (i % 28),
      driftDelay: -(i % 22),
    }))
  ).current

  const CENTER = 240

  return (
    <div className="relative w-full" style={{ height: '100svh', marginTop: -56, background: '#000' }}>
      {/* B4 — Starfield */}
      {stars.map((s, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            ...(s.drift ? {
              animation: `starDrift${i % 6} ${s.driftDuration}s ${s.driftDelay}s ease-in-out infinite alternate`,
            } : {}),
          }}
        />
      ))}

      {/* B3 — 3D perspective wrapper */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ perspective: '900px' }}>
        <div
          ref={systemRef}
          className="relative"
          style={{
            width: CENTER * 2,
            height: CENTER * 2,
            transform: 'rotateX(15deg)',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* Orbital rings */}
          {MAP_NODES.map(node => (
            <div
              key={`ring-${node.id}`}
              className="absolute rounded-full border"
              style={{
                width: node.radius * 2,
                height: node.radius * 2,
                top: CENTER - node.radius,
                left: CENTER - node.radius,
                borderColor: 'rgba(255,255,255,0.06)',
              }}
            />
          ))}

          {/* Center node */}
          <div
            className="absolute flex items-center justify-center rounded-full"
            style={{
              width: 68,
              height: 68,
              top: CENTER - 34,
              left: CENTER - 34,
              background: 'radial-gradient(circle at 38% 35%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.01) 100%)',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: '0 0 20px rgba(255,255,255,0.1), 0 0 40px rgba(255,255,255,0.05)',
              animation: 'atlasGlow 8s ease-in-out infinite',
            }}
          >
            <span className="text-[10px] font-bold tracking-[0.2em] text-white/80">ATLAS</span>
          </div>

          {/* Orbiting nodes */}
          {MAP_NODES.map((node, idx) => {
            const intensity = glowIntensity(node.id)
            return (
              <div
                key={node.id}
                className="absolute"
                style={{
                  width: node.radius * 2,
                  height: node.radius * 2,
                  top: CENTER - node.radius,
                  left: CENTER - node.radius,
                  animation: `orbit${idx} ${node.period}s linear infinite`,
                  opacity: entered ? 1 : 0,
                  transition: `opacity 600ms ease ${idx * 150}ms`,
                  pointerEvents: 'none',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: -node.size / 2,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    animation: `counterOrbit${idx} ${node.period}s linear infinite`,
                    pointerEvents: 'auto',
                  }}
                >
                  <motion.button
                    onClick={() => router.push(node.href)}
                    whileTap={{ scale: 1.25 }}
                    transition={{ duration: 0.15 }}
                    className="flex flex-col items-center gap-2 group"
                  >
                    {/* B3 — Sphere node with specular highlight */}
                    <div
                      className="rounded-full"
                      style={{
                        width: node.size,
                        height: node.size,
                        background: `radial-gradient(circle at 35% 30%, ${node.color}cc 0%, ${node.color}55 40%, ${node.color}18 70%, transparent 100%)`,
                        border: `1px solid ${node.color}${Math.round(intensity * 200).toString(16).padStart(2, '0')}`,
                        boxShadow: `0 0 ${Math.round(intensity * 28)}px ${node.glowColor}${Math.round(intensity * 160).toString(16).padStart(2, '0')}, inset 0 1px 0 ${node.color}44`,
                        transition: 'box-shadow 0.3s',
                      }}
                    />
                    <span
                      className="text-[10px] font-bold tracking-widest uppercase opacity-60 group-hover:opacity-100 transition-opacity duration-200"
                      style={{ color: node.color }}
                    >
                      {node.label}
                    </span>
                  </motion.button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        @keyframes atlasGlow {
          0%, 100% { box-shadow: 0 0 20px rgba(255,255,255,0.1), 0 0 40px rgba(255,255,255,0.05); }
          50% { box-shadow: 0 0 30px rgba(255,255,255,0.2), 0 0 60px rgba(255,255,255,0.1); }
        }
        @keyframes orbit0 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes orbit1 { from { transform: rotate(72deg); } to { transform: rotate(432deg); } }
        @keyframes orbit2 { from { transform: rotate(144deg); } to { transform: rotate(504deg); } }
        @keyframes orbit3 { from { transform: rotate(216deg); } to { transform: rotate(576deg); } }
        @keyframes orbit4 { from { transform: rotate(288deg); } to { transform: rotate(648deg); } }
        @keyframes counterOrbit0 { from { transform: translateX(-50%) rotate(0deg); } to { transform: translateX(-50%) rotate(-360deg); } }
        @keyframes counterOrbit1 { from { transform: translateX(-50%) rotate(-72deg); } to { transform: translateX(-50%) rotate(-432deg); } }
        @keyframes counterOrbit2 { from { transform: translateX(-50%) rotate(-144deg); } to { transform: translateX(-50%) rotate(-504deg); } }
        @keyframes counterOrbit3 { from { transform: translateX(-50%) rotate(-216deg); } to { transform: translateX(-50%) rotate(-576deg); } }
        @keyframes counterOrbit4 { from { transform: translateX(-50%) rotate(-288deg); } to { transform: translateX(-50%) rotate(-648deg); } }
        @keyframes starDrift0 { from { transform: translate(0,0); } to { transform: translate(3px,-4px); } }
        @keyframes starDrift1 { from { transform: translate(0,0); } to { transform: translate(-4px,3px); } }
        @keyframes starDrift2 { from { transform: translate(0,0); } to { transform: translate(2px,5px); } }
        @keyframes starDrift3 { from { transform: translate(0,0); } to { transform: translate(-3px,-3px); } }
        @keyframes starDrift4 { from { transform: translate(0,0); } to { transform: translate(5px,2px); } }
        @keyframes starDrift5 { from { transform: translate(0,0); } to { transform: translate(-2px,4px); } }
      `}</style>
    </div>
  )
}

// ─── Sunday Weekly Report Modal ───────────────────────────────────────────────

function getMostRecentSunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

function SundayModal({ onDismiss }: { onDismiss: () => void }) {
  const router = useRouter()
  const [report, setReport] = useState<{ report_text: string; week_of: string } | null>(null)

  useEffect(() => {
    fetch('/api/mentor/weekly-reports')
      .then(r => r.json())
      .then((reports: Array<{ report_text: string; week_of: string }>) => {
        const weekOf = getMostRecentSunday()
        const current = reports.find(r => r.week_of === weekOf)
        if (current) setReport(current)
      })
      .catch(() => {})
  }, [])

  if (!report) return null

  const preview = report.report_text.split(/[.!?]/).slice(0, 3).join('. ').trim() + '.'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6"
        style={{
          background: 'rgba(8,16,8,0.98)',
          border: '1px solid rgba(74,222,128,0.25)',
          boxShadow: '0 0 40px rgba(74,222,128,0.08)',
        }}
      >
        <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-green-700 mb-3">
          WEEK OF {new Date(report.week_of + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <p className="text-sm text-zinc-300 leading-relaxed mb-6">{preview}</p>
        <div className="flex gap-3">
          <button
            onClick={() => { router.push('/mentor?tab=reports'); onDismiss() }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-black"
            style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
          >
            Read Full Report
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-zinc-500"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function HomeClient({
  today,
  timezone: _timezone,
  initialCheckin,
}: {
  today: string
  timezone: string
  initialCheckin: DailyCheckin | null
}) {
  const queryClient = useQueryClient()
  if (initialCheckin) queryClient.setQueryData(['checkin', today], initialCheckin)

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    fetch('/api/user/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: tz }),
    })
  }, [])

  const { data: checkin } = useTodayCheckin(today)

  const [mapView, setMapView] = useState(false)
  const [activity, setActivity] = useState<ActivitySnapshot | null>(null)
  const [showSundayModal, setShowSundayModal] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('atlas_view_mode')
    if (saved === 'map') setMapView(true)
  }, [])

  useEffect(() => {
    fetch('/api/home/activity-snapshot')
      .then(r => r.json())
      .then(setActivity)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const isSunday = new Date().getDay() === 0
    if (!isSunday) return
    const weekOf = getMostRecentSunday()
    const key = `atlas_weekly_report_shown_${weekOf}`
    if (localStorage.getItem(key)) return
    const t = setTimeout(() => setShowSundayModal(true), 1000)
    return () => clearTimeout(t)
  }, [])

  function toggleMapView() {
    const next = !mapView
    setMapView(next)
    localStorage.setItem('atlas_view_mode', next ? 'map' : 'list')
  }

  if (mapView) {
    return (
      <>
        <motion.button
          onClick={toggleMapView}
          whileTap={{ scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed top-4 right-4 z-50 w-9 h-9 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
          aria-label="Switch to list view"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </motion.button>
        <CosmicMap activity={activity} />
        {showSundayModal && (
          <SundayModal onDismiss={() => {
            setShowSundayModal(false)
            localStorage.setItem(`atlas_weekly_report_shown_${getMostRecentSunday()}`, 'true')
          }} />
        )}
      </>
    )
  }

  const isCheckinActive = !checkin || checkin.evening_actual_training === null || checkin.evening_actual_training === undefined

  return (
    <>
      <main className="nebula-home min-h-screen px-4 pb-24 pt-14">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h1
            className="text-5xl font-bold tracking-tight"
            style={{
              background: 'linear-gradient(180deg, #FFFFFF 0%, #C7C4BC 120%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Luka&apos;s Dashboard
          </h1>
          <motion.button
            onClick={toggleMapView}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center mt-1"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
            aria-label="Switch to Atlas map"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <line x1="12" y1="2" x2="12" y2="8" />
              <line x1="12" y1="16" x2="12" y2="22" />
              <line x1="2" y1="12" x2="8" y2="12" />
              <line x1="16" y1="12" x2="22" y2="12" />
            </svg>
          </motion.button>
        </div>

        <GoalTicker checkin={checkin} />

        {/* Day ring */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <DayRing />
          <TodaysCallCard />
        </motion.div>

        {/* Bento module grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.08 }}
        >
          <SectionTitle label="Modules" />
          <BentoGrid />
        </motion.div>

        {/* Check-in */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.16 }}
        >
          <SectionTitle label="Check-in" />
          <motion.div
            animate={isCheckinActive ? {
              boxShadow: [
                '0 0 0px rgba(74,222,128,0)',
                '0 0 16px rgba(74,222,128,0.12)',
                '0 0 0px rgba(74,222,128,0)',
              ],
            } : { boxShadow: '0 0 0px rgba(74,222,128,0)' }}
            transition={isCheckinActive ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : {}}
            style={{ borderRadius: 16 }}
          >
            <DailyCheckinCard today={today} checkin={checkin ?? null} />
          </motion.div>
        </motion.div>

        {/* Briefing */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.24 }}
          className="mt-4"
        >
          <BriefingCard />
        </motion.div>

        <div className="px-4 pb-6 flex justify-center mt-6">
          <a href="/subscriptions" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            Bills &amp; subscriptions →
          </a>
        </div>
      </main>

      {showSundayModal && (
        <SundayModal onDismiss={() => {
          setShowSundayModal(false)
          localStorage.setItem(`atlas_weekly_report_shown_${getMostRecentSunday()}`, 'true')
        }} />
      )}
    </>
  )
}
