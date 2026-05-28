'use client'

import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayCheckin } from '@/features/workouts/queries'
import { useSaveEveningCheckin } from '@/features/workouts/mutations'
import type { DailyCheckin } from '@/features/workouts/types'

// ─── Day Ring ────────────────────────────────────────────────────────────────

const WAKE_HOUR  = 8
const SLEEP_HOUR = 24
const CIRC = 2 * Math.PI * 52  // 326.73...

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
  const [ring, setRing] = useState<RingState>(computeRing)
  useEffect(() => {
    const id = setInterval(() => setRing(computeRing()), 30_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="flex flex-wrap items-center justify-center gap-[26px] p-[22px] mb-[22px] rounded-2xl bg-white/[0.04] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
      {/* Ring SVG */}
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
            stroke={ring.stroke} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={ring.offset}
            filter="url(#drGlow)"
            style={{
              transform: 'rotate(-90deg)', transformOrigin: '60px 60px',
              transition: 'stroke 0.7s cubic-bezier(0.22,1,0.36,1), stroke-dashoffset 0.7s cubic-bezier(0.22,1,0.36,1)',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[40px] font-extrabold tabular-nums tracking-[-0.04em] leading-none text-white">
            {ring.percent === null ? '—' : `${ring.percent}%`}
          </span>
          <span className="mt-[5px] font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
            {ring.phase}
          </span>
          <span className="font-mono text-[10.5px] text-zinc-500 mt-0.5">{ring.clock}</span>
        </div>
      </div>

      {/* Text */}
      <div className="flex flex-col gap-1.5 max-w-[280px]">
        <div className="text-[14px] font-bold text-white">{ring.status}</div>
        <div className="font-mono text-[12px] text-zinc-400">{ring.remaining}</div>
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

  // Reset on checkin change
  useEffect(() => {
    setCur(0)
    setPrev(null)
    if (pendingT.current) clearTimeout(pendingT.current)
  }, [checkin])

  // Cycle
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
      {/* Sweep shimmer */}
      <div className="absolute top-0 bottom-0 w-[30%] pointer-events-none"
        style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,0.04),transparent)', animation: 'ticker-sweep 8s linear infinite' }} />

      {/* LED */}
      <span className="w-[7px] h-[7px] rounded-full flex-shrink-0 animate-led-pulse"
        style={{ background: dotColor, boxShadow: dotGlow }} />

      {/* Label */}
      <span className="font-mono text-[9.5px] font-extrabold tracking-[0.18em] text-zinc-600 uppercase flex-shrink-0">
        CHECKINS
      </span>

      {/* Stage */}
      <div className="relative overflow-hidden flex-1 h-[22px]">
        {/* Leaving item */}
        {prevItem && (
          <div className="absolute inset-0 flex items-center gap-2 font-mono text-[12.5px] font-semibold tabular-nums text-white whitespace-nowrap is-leaving">
            <span className="inline-flex justify-center w-[18px]"
              style={{ color: prevItem.status === 'done' ? '#6BE3A4' : 'rgba(255,255,255,0.4)' }}>
              {statusGlyph(prevItem.status)}
            </span>
            <span className="flex-1 overflow-hidden text-ellipsis">{prevItem.text}</span>
          </div>
        )}
        {/* Current item */}
        <div className={`absolute inset-0 flex items-center gap-2 font-mono text-[12.5px] font-semibold tabular-nums text-white whitespace-nowrap ${prevItem ? 'is-entering' : ''}`}>
          <span className="inline-flex justify-center w-[18px]"
            style={{ color: curItem.status === 'done' ? '#6BE3A4' : 'rgba(255,255,255,0.4)' }}>
            {statusGlyph(curItem.status)}
          </span>
          <span className="flex-1 overflow-hidden text-ellipsis">{curItem.text}</span>
        </div>
      </div>

      {/* Count badge */}
      <span className="font-mono text-[11px] font-bold tracking-[0.04em] tabular-nums text-zinc-400 px-2 py-[3px] rounded-full flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.04)' }}>
        {done}/{total}
      </span>
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
      <div className="rounded-2xl bg-white/[0.04] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)] p-5">
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
    <div className="rounded-2xl bg-white/[0.04] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)] p-5">
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function HomeClient({ today, initialCheckin }: { today: string; initialCheckin: DailyCheckin | null }) {
  const queryClient = useQueryClient()
  if (initialCheckin) queryClient.setQueryData(['checkin', today], initialCheckin)

  const { data: checkin } = useTodayCheckin(today)

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
    <main className="min-h-screen px-4 pb-24 pt-14">
      <GoalTicker checkin={checkin} />
      <DayRing />

      <section>
        <SectionTitle label="Check-in" />
        <DailyCheckinCard today={today} checkin={checkin ?? null} />

        <div className="mt-4 rounded-2xl bg-white/[0.04] backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.45)] p-5">
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
      </section>
    </main>
  )
}
