'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useTodayCheckin } from '@/features/checkins/queries'
import { useSaveEveningCheckin } from '@/features/checkins/mutations'
import type { DailyCheckin } from '@/features/checkins/types'
import { useDayPlan } from '@/features/journal/queries'
import type { DayPlanData } from '@/features/journal/types'
import type { BentoStats } from '@/lib/home/bentoStats'
import type { Streaks } from '@/lib/home/streaks'
import StreakStrip from './StreakStrip'
import ApiKeyBanner from './ApiKeyBanner'
import { computeRing, CIRC, ringBounds, type RingState } from '@/features/home/dayRing'
import { fmtClockHour, type ScheduleHours } from '@/lib/schedule'
import { checkNoApiKey, checkAiLimit, type KeyProvider } from '@/lib/apiKeyError'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'
import AiLimitNotice from '@/components/AiLimitNotice'
import ChatText from '@/components/ChatText'

// Code-split the Three.js HUD so it never enters the main bundle — loads only
// when the user opens map view. ssr:false because it's a WebGL/client-only view.
const AtlasHUD = dynamic(() => import('@/features/home/atlas-hud/AtlasHUD'), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-black" />,
})

// ─── Day Ring ────────────────────────────────────────────────────────────────

function DayRing({ schedule }: { schedule: ScheduleHours }) {
  const [ring, setRing] = useState<RingState | null>(null)
  useEffect(() => {
    setRing(computeRing(schedule))
    const id = setInterval(() => setRing(computeRing(schedule)), 30_000)
    return () => clearInterval(id)
  }, [schedule])
  const bounds = ringBounds(schedule)

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
        <div className="font-mono text-[11px] text-zinc-500">{fmtClockHour(bounds.wake)} – {fmtClockHour(bounds.sleep)}</div>
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

// ── Card-specific visualizations ─────────────────────────────────────────────

/** TRAIN: EKG / heartrate pulse line with a moving dot */
function TrainVisual({ color }: { color: string }) {
  const W = 76, H = 44, mid = H / 2
  const d = `M2,${mid} L13,${mid} L17,${mid - 2} L20,${mid + 7} L24,${mid - 18} L28,${mid + 12} L32,${mid} L${W - 2},${mid}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
      style={{ display: 'block', marginTop: 12, marginRight: 10, overflow: 'visible' }}>
      <defs>
        <path id="ekgP" d={d} />
        <linearGradient id="ekgFade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset="45%" stopColor={color} stopOpacity="0.75" />
          <stop offset="100%" stopColor={color} stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {/* Glow blur copy */}
      <use href="#ekgP" fill="none" stroke={color} strokeWidth="5"
        opacity="0.09" style={{ filter: 'blur(3px)' }} />
      {/* Main line */}
      <use href="#ekgP" fill="none" stroke="url(#ekgFade)" strokeWidth="1.8"
        strokeLinejoin="round" strokeLinecap="round" />
      {/* Moving dot */}
      <circle r="2.8" fill={color}
        style={{ filter: `drop-shadow(0 0 7px ${color})` }}>
        <animateMotion dur="2.8s" repeatCount="indefinite">
          <mpath href="#ekgP" />
        </animateMotion>
      </circle>
    </svg>
  )
}

/** FUEL: Rotating 3D orbital sphere — crossed tilted rings + orbiting dots */
function FuelOrb({ calories, color }: { calories: number; color: string }) {
  const lit = calories > 0
  return (
    <div style={{ width: 68, height: 68, position: 'relative', marginTop: 4, marginRight: 4, flexShrink: 0 }}>
      <div style={{
        position: 'absolute', inset: 6, borderRadius: '50%',
        background: color, filter: 'blur(18px)', opacity: lit ? 0.22 : 0.06,
        animation: 'bentoGlow 3.5s ease-in-out infinite',
      }} />
      <svg viewBox="0 0 68 68" width="68" height="68" style={{ position: 'absolute', inset: 0 }}>
        {/* Tilted orbital ring — rotates clockwise (3D gyroscope feel) */}
        <g style={{ transformOrigin: '34px 34px', animation: 'spin 9s linear infinite' }}>
          <ellipse cx="34" cy="34" rx="26" ry="10" fill="none" stroke={color} strokeWidth="0.7"
            opacity={lit ? 0.2 : 0.1} strokeDasharray="3 5" />
          <circle cx="60" cy="34" r="2.4" fill={color} opacity={lit ? 0.8 : 0.18}
            style={{ filter: `drop-shadow(0 0 5px ${color})` }} />
        </g>
        {/* Second ring, opposite tilt + counter-rotation → crossing orbits */}
        <g style={{ transformOrigin: '34px 34px', animation: 'spinRev 7s linear infinite' }}>
          <ellipse cx="34" cy="34" rx="10" ry="26" fill="none" stroke={color} strokeWidth="0.6"
            opacity={lit ? 0.14 : 0.08} strokeDasharray="3 5" />
          <circle cx="34" cy="8" r="1.7" fill={color} opacity={lit ? 0.55 : 0.13}
            style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        </g>
        {/* Core */}
        <circle cx="34" cy="34" r={lit ? 5 : 4} fill={color}
          opacity={lit ? 0.85 : 0.18}
          style={{ filter: `drop-shadow(0 0 6px ${color})`, animation: 'bentoGlow 3.5s ease-in-out infinite' }} />
      </svg>
    </div>
  )
}

/** JOURNAL: Handwriting — wavy "lines of text" that draw themselves, looping */
function JournalMood({ mood, color }: { mood: number | null; color: string }) {
  const moodColors = [color, '#f87171', '#fb923c', '#fbbf24', '#4ade80', '#34d399']
  const c = mood != null ? (moodColors[mood] ?? color) : color
  const lit = mood != null
  // Three cursive-ish strokes of decreasing length — like handwritten lines
  const lines = [
    'M5,13 q4,-4 8,0 t8,0 t8,0 t8,0',
    'M5,24 q4,4 8,0 t8,0 t8,0',
    'M5,35 q4,-4 8,0 t8,0',
  ]
  return (
    <div style={{ width: 60, height: 56, position: 'relative', marginTop: 6, marginRight: 6, flexShrink: 0 }}>
      <div style={{
        position: 'absolute', inset: 10, borderRadius: '50%',
        background: c, filter: 'blur(16px)', opacity: lit ? 0.22 : 0.06,
        animation: 'bentoGlow 3.4s ease-in-out infinite',
      }} />
      <svg viewBox="0 0 60 48" width="60" height="48" style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        {lines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={c} strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"
            opacity={lit ? 0.9 : 0.25}
            style={{
              strokeDasharray: 60, strokeDashoffset: 60,
              filter: `drop-shadow(0 0 3px ${c}aa)`,
              animation: `journalWrite 4.5s ease-in-out ${i * 0.6}s infinite`,
            }} />
        ))}
      </svg>
    </div>
  )
}

/** ENERGY: Mini circadian energy arc with current-position dot */
function EnergyArc({ color, schedule }: { color: string; schedule: ScheduleHours }) {
  const W = 82, H = 48
  // Wake → bedtime from Settings; the energy model's own defaults when unset.
  const wakeHour = schedule.wakeHour ?? 6.5
  const totalAwake = Math.max(4, (schedule.sleepHour ?? 23.5) - wakeHour)
  // Time-dependent — resolve only after mount so the server HTML and the first
  // client render match (otherwise the gradient offset + marker position differ
  // and React throws a hydration mismatch). Before mount we render a neutral midday.
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const hoursAwake = now ? Math.max(0, now.getHours() + now.getMinutes() / 60 - wakeHour) : totalAwake / 2

  function energyAt(t: number): number {
    // Circadian model: peaks ~3h after wake, gentle afternoon dip, evening decline
    const morning = 70 * Math.exp(-Math.pow(t - 3, 2) / 20)
    const afternoon = 15 * Math.exp(-Math.pow(t - 7, 2) / 4)
    const base = 35 - t * 1.8
    return Math.max(5, Math.min(95, base + morning - afternoon))
  }

  const pts: Array<[number, number]> = []
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * totalAwake
    const e = energyAt(t)
    pts.push([(i / 24) * (W - 4) + 2, H - 4 - (e / 100) * (H - 10)])
  }
  const path = 'M ' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')

  const curX = Math.min(W - 6, Math.max(2, (hoursAwake / totalAwake) * (W - 4) + 2))
  const curT = (hoursAwake / totalAwake) * totalAwake
  const curE = energyAt(curT)
  const curY = H - 4 - (curE / 100) * (H - 10)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}
      style={{ display: 'block', marginTop: 10, marginRight: 6, overflow: 'visible' }}>
      <defs>
        <linearGradient id="eGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset={`${Math.min(98, (hoursAwake / totalAwake) * 100).toFixed(0)}%`} stopColor={color} stopOpacity="0.65" />
          <stop offset="100%" stopColor={color} stopOpacity="0.12" />
        </linearGradient>
        <path id="ePath" d={path} />
      </defs>
      <use href="#ePath" fill="none" stroke="url(#eGrad)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Traveling pulse riding the curve — the "moving" Luka wants */}
      <circle r="2" fill={color} opacity="0.85" style={{ filter: `drop-shadow(0 0 5px ${color})` }}>
        <animateMotion dur="5.5s" repeatCount="indefinite" calcMode="spline"
          keyTimes="0;1" keySplines="0.4 0 0.6 1">
          <mpath href="#ePath" />
        </animateMotion>
        <animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.08;0.92;1"
          dur="5.5s" repeatCount="indefinite" />
      </circle>
      {/* Current-position marker — only after mount (time-dependent) */}
      {now && (
        <circle cx={curX.toFixed(1)} cy={curY.toFixed(1)} r="3.5" fill={color}
          style={{ filter: `drop-shadow(0 0 6px ${color}cc)`, animation: 'bentoGlow 2.5s ease-in-out infinite' }} />
      )}
    </svg>
  )
}

// ── BentoCard shell ───────────────────────────────────────────────────────────

interface BentoCardProps {
  href: string
  color: string
  label: string
  headline: string
  sub?: string
  wide?: boolean
  loading?: boolean
  dim?: boolean
  visual?: React.ReactNode
}

function BentoCard({ href, color, label, headline, sub, wide, loading, dim, visual }: BentoCardProps) {
  const router = useRouter()
  return (
    <motion.button
      onClick={() => router.push(href)}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className={`text-left flex flex-col relative overflow-hidden ${wide ? 'col-span-2' : ''}`}
      style={{
        background: dim ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)',
        border: `1px solid rgba(255,255,255,${dim ? '0.05' : '0.07'})`,
        borderLeft: `2px solid ${dim ? 'rgba(255,255,255,0.06)' : color}`,
        borderRadius: 18,
        minHeight: wide ? 80 : 112,
        opacity: dim ? 0.5 : 1,
        padding: `14px ${visual && !dim ? 90 : 14}px 14px 16px`,
      }}
    >
      {/* Color wash */}
      {!dim && (
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(ellipse at 0% 60%, ${color}0e 0%, transparent 65%)` }} />
      )}

      {/* Visual — top right */}
      {visual && !dim && (
        <div className="absolute top-0 right-0 pointer-events-none flex items-start">
          {visual}
        </div>
      )}

      {/* Label */}
      <span className="text-[9px] font-extrabold tracking-[0.22em] uppercase relative z-10 shrink-0 truncate block"
        style={{ color: dim ? 'rgba(255,255,255,0.2)' : color }}>
        {label}
      </span>

      {/* Content — pushed to bottom */}
      <div className="relative z-10 mt-auto overflow-hidden">
        {loading ? (
          <div className="h-4 w-3/4 rounded bg-white/[0.06] animate-pulse" />
        ) : (
          // suppressHydrationWarning: headline/sub can contain "now"-relative time
          // (fmtRelTime) + toLocaleString, which differ server vs client → React #418
          <span suppressHydrationWarning className="text-[13px] font-bold text-white leading-snug truncate block">{headline}</span>
        )}
        {sub && !loading && (
          <p suppressHydrationWarning className="text-[11px] text-zinc-500 mt-0.5 leading-snug truncate">{sub}</p>
        )}
      </div>
    </motion.button>
  )
}

function BentoGrid({ initial, schedule }: { initial?: BentoStats; schedule: ScheduleHours }) {
  const [stats, setStats] = useState<BentoStats | null>(initial ?? null)
  const [loading, setLoading] = useState(initial === undefined)

  useEffect(() => {
    if (initial !== undefined) return // seeded server-side; skip the client fetch
    fetch('/api/home/bento-stats', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: BentoStats & { error?: string }) => {
        if (d.error) { setLoading(false); return }
        setStats(d); setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [initial])

  // Train — prefer recent check-in when no formal workout recently
  const msPerDay = 1000 * 60 * 60 * 24
  const workoutAgeDays = stats?.lastWorkout
    ? Math.floor((Date.now() - new Date(stats.lastWorkout.completedAt).getTime()) / msPerDay)
    : Infinity
  const checkinAgeDays = stats?.recentTrainingCheckin
    ? Math.floor((Date.now() - new Date(stats.recentTrainingCheckin.date + 'T12:00:00').getTime()) / msPerDay)
    : Infinity
  const useCheckin = checkinAgeDays < workoutAgeDays && checkinAgeDays <= 3

  const hasTrainData = useCheckin || !!stats?.lastWorkout
  const trainHeadline = loading ? '' :
    useCheckin ? (stats?.recentTrainingCheckin?.activity ?? '') :
    stats?.lastWorkout?.name ?? 'Workouts · splits · sessions'
  const trainSub = loading ? '' :
    useCheckin
      ? `${checkinAgeDays === 0 ? 'Today' : `${checkinAgeDays}d ago`}${(stats?.workoutCount7d ?? 0) > 0 ? ` · ${stats!.workoutCount7d}x this week` : ''}`
      : stats?.lastWorkout
        ? `${fmtRelTime(stats.lastWorkout.completedAt)} · ${stats.workoutCount7d}x this week`
        : 'Strength · cardio · performance'
  const trainDim = false  // always lit

  // Fuel
  const fuelHeadline = loading ? '' :
    (stats?.todayCalories ?? 0) > 0 ? `${stats!.todayCalories.toLocaleString()} cal` : 'Macros · water · weight'
  const fuelSub = (stats?.todayProtein ?? 0) > 0
    ? `${stats!.todayProtein}g protein today`
    : 'Food log · supplements'
  const fuelDim = false  // always lit — fuel tab is always relevant

  // Journal
  const je = stats?.lastJournal
  const journalHeadline = loading ? '' : je ? (je.snippet || 'Journal') : 'Entries · mood · reflections'
  const journalSub = je ? fmtRelTime(je.createdAt) : 'Voice · text · AI reflection'
  const journalDim = false  // always lit

  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <BentoCard
        href="/gym" color="#4ade80" label="Train"
        headline={trainHeadline} sub={trainSub}
        loading={loading} dim={trainDim}
        visual={<TrainVisual color="#4ade80" />}
      />
      <BentoCard
        href="/health#food" color="#22d3ee" label="Fuel"
        headline={fuelHeadline} sub={fuelSub}
        loading={loading} dim={fuelDim}
        visual={<FuelOrb calories={stats?.todayCalories ?? 0} color="#22d3ee" />}
      />
      <BentoCard
        href="/journal" color="#fbbf24" label="Journal"
        headline={journalHeadline} sub={journalSub}
        loading={loading} dim={journalDim}
        visual={<JournalMood mood={je?.mood ?? null} color="#fbbf24" />}
      />
      <BentoCard
        href="/health/caffeine" color="#fb923c" label="Energy"
        headline="Energy curve" sub="Caffeine · circadian · meals"
        loading={false} dim={false}
        visual={<EnergyArc color="#fb923c" schedule={schedule} />}
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

function TodaysCallCard({ initial }: { initial?: TodaysCallData | null }) {
  const [data, setData] = useState<TodaysCallData | null>(initial ?? null)
  const [loading, setLoading] = useState(false)
  const [noData, setNoData] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [keyProvider, setKeyProvider] = useState<KeyProvider | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  const fetched = useRef(false)

  const fetch_ = useCallback(async (refresh = false) => {
    if (loading) return
    setLoading(true)
    try {
      const url = refresh ? '/api/home/todays-call?refresh=1' : '/api/home/todays-call'
      const res = await fetch(url, { method: 'POST' })
      if (!res.ok) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) setKeyProvider(keyErr.provider)
        else if (await checkAiLimit(res)) setLimitReached(true)
        return
      }
      const json = await res.json()
      if (json.noData) { setNoData(true); return }
      setKeyProvider(null)
      setLimitReached(false)
      setData(json)
    } finally {
      setLoading(false)
    }
  }, [loading])

  useEffect(() => {
    setCollapsed(localStorage.getItem('atlas:todaysCall:collapsed') === '1')
  }, [])

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true
    if (initial) return // seeded from server cache; skip the mount POST
    fetch_()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function toggleCollapsed() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('atlas:todaysCall:collapsed', next ? '1' : '0')
  }

  if (noData) return null
  if (keyProvider && !data) return <NoApiKeyNotice provider={keyProvider} className="mb-4" />
  if (limitReached && !data) return <AiLimitNotice className="mb-4" />
  if (!data && !loading) return null

  const color = data ? VERDICT_COLOR[data.color] : 'rgba(255,255,255,0.2)'
  const border = data ? VERDICT_BORDER[data.color] : 'rgba(255,255,255,0.08)'

  return (
    <div
      className="rounded-2xl px-5 py-4 mb-4"
      style={{ background: '#0e0e10', border: `1px solid ${border}`, borderLeft: `3px solid ${color}` }}
    >
      <div
        className="flex items-center justify-between cursor-pointer select-none"
        onClick={toggleCollapsed}
      >
        {/* Header carries the verdict colour so the card reads at a glance */}
        <span
          className="flex items-center gap-2 text-[10px] font-bold tracking-[0.18em] uppercase"
          style={{ color: data ? color : 'rgba(255,255,255,0.4)' }}
        >
          <span
            className="inline-block transition-transform duration-200 opacity-70"
            style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >▾</span>
          Today&apos;s Call
        </span>
        <div className="flex items-center gap-2">
          {data && !loading && !collapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); fetch_(true) }}
              className="text-[11px] text-white/20 hover:text-white/50 transition-colors"
              title="Refresh"
            >↺</button>
          )}
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
      </div>

      {!collapsed && (
        <div className="mt-3">
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
      )}
    </div>
  )
}

// ─── Day Plan ─────────────────────────────────────────────────────────────────

const DAY_PLAN_PREVIEW_COUNT = 3
// Warm amber wash + lit sun, so the card reads as today's headline rather than
// another dim panel
const DAY_PLAN_BG = 'linear-gradient(180deg, rgba(251,191,36,0.07), rgba(251,191,36,0.015)), #0e0e10'
const SUN_GLOW = 'drop-shadow(0 0 6px rgba(251,191,36,0.6))'

function DayPlanCard({ initial }: { initial?: DayPlanData | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data } = useDayPlan(initial)
  // Just-ticked items stay visible (struck through) briefly before dropping out
  const [lingering, setLingering] = useState<Set<string>>(new Set())

  function toggleItem(itemId: string) {
    if (!data) return
    const prev = data
    const nextPlan = data.plan.map(p => (p.id === itemId ? { ...p, done: !p.done } : p))
    queryClient.setQueryData<DayPlanData | null>(['home', 'day-plan'], { ...data, plan: nextPlan })

    const nowDone = nextPlan.find(p => p.id === itemId)?.done
    if (nowDone) {
      setLingering(s => new Set(s).add(itemId))
      setTimeout(() => {
        setLingering(s => {
          const next = new Set(s)
          next.delete(itemId)
          return next
        })
      }, 900)
    }

    // Write back to the journal entry (source of truth); revert on failure
    const revert = () => queryClient.setQueryData<DayPlanData | null>(['home', 'day-plan'], prev)
    fetch(`/api/journal/${data.entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: nextPlan }),
    }).then(res => { if (!res.ok) revert() }).catch(revert)
  }

  if (data === undefined) return null

  // No morning plan yet — soft nudge to make one
  if (data === null || data.plan.length === 0) {
    const href = data === null ? '/journal/new' : `/journal/${data.entryId}`
    return (
      <button
        onClick={() => router.push(href)}
        className="w-full rounded-2xl px-5 py-4 mb-4 flex items-center justify-between active:opacity-80 transition-opacity"
        style={{ background: DAY_PLAN_BG, border: '1px solid rgba(251,191,36,0.28)' }}
      >
        <span className="flex items-center gap-2 text-sm text-zinc-300">
          <span style={{ filter: SUN_GLOW }}>☀️</span>
          Plan your day
        </span>
        <span className="text-amber-300/50 text-sm">→</span>
      </button>
    )
  }

  const unchecked = data.plan.filter(p => !p.done)
  const preview = data.plan
    .filter(p => !p.done || lingering.has(p.id))
    .slice(0, DAY_PLAN_PREVIEW_COUNT)
  const moreCount = unchecked.length - preview.filter(p => !p.done).length

  // The whole card opens the plan — header, task text, counter, empty space.
  // Only the checkboxes opt out (they stopPropagation).
  return (
    <div
      onClick={() => router.push(`/journal/${data.entryId}`)}
      className="rounded-2xl px-5 py-4 mb-4 cursor-pointer active:opacity-90 transition-opacity"
      style={{ background: DAY_PLAN_BG, border: '1px solid rgba(251,191,36,0.28)', borderLeft: '3px solid rgba(251,191,36,0.75)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[0.18em] uppercase text-amber-300/85">
          <span style={{ filter: SUN_GLOW }}>☀️</span>
          Day Plan
        </span>
        <span className="text-[11px] text-amber-200/45">
          {unchecked.length}/{data.plan.length} left →
        </span>
      </div>

      {preview.length === 0 ? (
        <p className="text-sm text-zinc-400">Day planned ✓ — all done</p>
      ) : (
        <div className="space-y-1.5">
          {preview.map(item => (
            <div key={item.id} className="flex items-start gap-3">
              <button
                onClick={(e) => { e.stopPropagation(); toggleItem(item.id) }}
                className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors"
                style={{
                  background: item.done ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.06)',
                  border: item.done ? '1px solid rgba(251,191,36,0.5)' : '1px solid rgba(251,191,36,0.28)',
                }}
              >
                {item.done && <span className="text-[11px] leading-none text-amber-300">✓</span>}
              </button>
              <span
                className={`min-w-0 flex-1 text-left text-sm leading-snug transition-all duration-300 ${
                  item.done ? 'text-zinc-600 line-through decoration-zinc-600' : 'text-white/90'
                }`}
              >
                {item.text}
              </span>
            </div>
          ))}
          {moreCount > 0 && (
            <p className="pl-8 text-xs text-amber-200/40">
              +{moreCount} more →
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Briefing Card ────────────────────────────────────────────────────────────

function BriefingCard({ initialContent }: { initialContent?: string | null }) {
  const [coachText, setCoachText] = useState(initialContent ?? '')
  const [coachStreaming, setCoachStreaming] = useState(false)
  const [loading, setLoading] = useState(initialContent === undefined)
  const [keyProvider, setKeyProvider] = useState<KeyProvider | null>(null)

  useEffect(() => {
    if (initialContent !== undefined) return // seeded server-side; skip the client fetch
    fetch('/api/home/briefing')
      .then(r => r.json())
      .then(({ content }: { content: string | null }) => { if (content) setCoachText(content) })
      .finally(() => setLoading(false))
  }, [initialContent])

  async function streamBriefing() {
    if (coachStreaming) return
    setCoachStreaming(true)
    setCoachText('')
    setKeyProvider(null)
    try {
      const res = await fetch('/api/home/coach', { method: 'POST' })
      if (!res.ok || !res.body) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) setKeyProvider(keyErr.provider)
        else setCoachText('Something went wrong. Try again.')
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
      {loading && (
        <div className="space-y-2 mb-4">
          <div className="h-3 rounded bg-white/[0.06] animate-pulse w-full" />
          <div className="h-3 rounded bg-white/[0.06] animate-pulse w-5/6" />
          <div className="h-3 rounded bg-white/[0.06] animate-pulse w-4/6" />
        </div>
      )}
      {!loading && keyProvider && (
        <NoApiKeyNotice provider={keyProvider} className="mb-4" />
      )}
      {!loading && !keyProvider && !coachText && !coachStreaming && (
        <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
          Get a read on where you stand across everything — gym, habits, health, journal.
        </p>
      )}
      {!loading && coachText && (
        <ChatText
          className="text-sm text-zinc-300 leading-relaxed mb-4"
          text={coachText}
          cursor={coachStreaming ? (
            <span className="inline-block w-[2px] h-[14px] bg-zinc-400 ml-0.5 align-middle animate-pulse" />
          ) : undefined}
        />
      )}
      {!loading && !coachText && coachStreaming && (
        <p className="text-sm text-zinc-500 mb-4 leading-relaxed">
          Reading your data
          <span className="inline-block w-[2px] h-[14px] bg-zinc-400 ml-0.5 align-middle animate-pulse" />
        </p>
      )}
      {!loading && (
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
      )}
    </div>
  )
}

// ─── Sunday Weekly Report Modal ───────────────────────────────────────────────

function getMostRecentSunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

function SundayModal({ onDismiss, initialReports }: { onDismiss: () => void; initialReports?: Array<{ report_text: string; week_of: string }> }) {
  const router = useRouter()
  const [report, setReport] = useState<{ report_text: string; week_of: string } | null>(() => {
    if (initialReports) {
      const weekOf = getMostRecentSunday()
      return initialReports.find(r => r.week_of === weekOf) ?? null
    }
    return null
  })

  useEffect(() => {
    if (initialReports !== undefined) return // seeded server-side; skip the client fetch
    fetch('/api/mentor/weekly-reports')
      .then(r => r.json())
      .then((reports: Array<{ report_text: string; week_of: string }>) => {
        const weekOf = getMostRecentSunday()
        const current = reports.find(r => r.week_of === weekOf)
        if (current) setReport(current)
      })
      .catch(() => {})
  }, [initialReports])

  if (!report) return null

  const plainText = report.report_text.replace(/[*_#`]/g, '').replace(/^\s*-\s+/gm, '')
  const preview = plainText.split(/[.!?]/).slice(0, 3).join('. ').trim() + '.'

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
  displayName,
  initialCheckin,
  initialBento,
  initialTodaysCall,
  initialBriefing,
  initialWeeklyReports,
  initialStreaks,
  initialDayPlan,
  schedule,
}: {
  today: string
  timezone: string
  displayName: string
  schedule: ScheduleHours
  initialCheckin: DailyCheckin | null
  initialBento?: BentoStats
  initialTodaysCall?: TodaysCallData | null
  initialBriefing?: string | null
  initialWeeklyReports?: Array<{ week_of: string; report_text: string }>
  initialStreaks?: Streaks
  initialDayPlan?: DayPlanData | null
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
  const [showSundayModal, setShowSundayModal] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('atlas_view_mode')
    if (saved === 'map') setMapView(true)
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
        <AtlasHUD schedule={schedule} />
        {showSundayModal && (
          <SundayModal initialReports={initialWeeklyReports} onDismiss={() => {
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
        <div className="flex items-start justify-between gap-3 mb-4">
          {/* Fluid size so the title never pushes the map toggle off-screen on
              narrow phones; min-w-0 + wrapping is the fallback for long names. */}
          <h1
            className="min-w-0 text-[clamp(1.9rem,8.8vw,2.7rem)] font-bold tracking-tight leading-[1.05]"
            style={{
              background: 'linear-gradient(180deg, #FFFFFF 0%, #C7C4BC 120%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            {displayName}&apos;s Dashboard
          </h1>
          <motion.button
            onClick={toggleMapView}
            whileTap={{ scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center mt-0.5"
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

        <ApiKeyBanner />

        <GoalTicker checkin={checkin} />

        {/* Day ring */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <DayRing schedule={schedule} />
          <TodaysCallCard initial={initialTodaysCall} />
          <DayPlanCard initial={initialDayPlan} />
        </motion.div>

        {/* Consistency strip */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.06 }}
        >
          <SectionTitle label="Consistency" />
          <StreakStrip initial={initialStreaks} />
        </motion.div>

        {/* Bento module grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut', delay: 0.08 }}
        >
          <SectionTitle label="Modules" />
          <BentoGrid initial={initialBento} schedule={schedule} />
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
          <BriefingCard initialContent={initialBriefing} />
        </motion.div>

        <div className="px-4 pb-6 flex justify-center gap-6 mt-6">
          <a href="/subscriptions" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            Bills &amp; subscriptions →
          </a>
          <a href="/settings" data-tour="settings-link" className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
            Settings →
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
