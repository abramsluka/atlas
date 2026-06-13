'use client'

import { useEffect, useMemo, useState } from 'react'
import { computeRing, CIRC, type RingState } from '@/features/home/dayRing'
import type { BentoStats } from '@/app/api/home/bento-stats/route'

// ─── Jarvis HUD overlay: crisp DOM/SVG on top of the 3D globe canvas ───────────
// Big panels stacked down the left and right edges (like the reference HUD),
// framing the globe. pointer-events-none so drag-to-orbit and planet clicks fall
// through to the canvas. Holographic cyan, mono, tabular numbers. The right
// column mixes real Vitals with decorative telemetry for the sci-fi HUD feel.

type Verdict = 'GREEN' | 'YELLOW' | 'RED'
interface TodaysCall { color: Verdict; headline: string; bullets: string[] }
const VERDICT: Record<Verdict, string> = { GREEN: '#4ade80', YELLOW: '#fbbf24', RED: '#f87171' }
const CYAN = '#7fdfff'

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? '1d ago' : `${d}d ago`
}

function Corner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const map = {
    tl: 'top-3 left-3 border-l border-t',
    tr: 'top-3 right-3 border-r border-t',
    bl: 'bottom-3 left-3 border-l border-b',
    br: 'bottom-3 right-3 border-r border-b',
  } as const
  return <div className={`absolute w-6 h-6 pointer-events-none ${map[pos]}`} style={{ borderColor: 'rgba(127,223,255,0.35)' }} />
}

function Panel({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`pointer-events-none rounded-xl px-4 py-3 ${className}`}
      style={{
        background: 'rgba(4,10,16,0.55)',
        border: '1px solid rgba(127,223,255,0.16)',
        backdropFilter: 'blur(7px)',
        boxShadow: '0 0 22px rgba(40,120,180,0.14), inset 0 1px 0 rgba(127,223,255,0.06)',
      }}
    >
      <div className="font-mono text-[10px] sm:text-[11px] font-bold tracking-[0.24em] uppercase mb-2" style={{ color: 'rgba(127,223,255,0.6)' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function DayArc({ ring }: { ring: RingState | null }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-[64px] h-[64px] sm:w-[76px] sm:h-[76px] shrink-0">
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(127,223,255,0.10)" strokeWidth="8" />
          <circle
            cx="60" cy="60" r="52" fill="none"
            stroke={ring?.stroke ?? CYAN} strokeWidth="8" strokeLinecap="round"
            strokeDasharray={CIRC} strokeDashoffset={ring?.offset ?? CIRC}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '60px 60px', transition: 'stroke-dashoffset 0.7s, stroke 0.7s' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[18px] sm:text-[21px] font-extrabold tabular-nums text-white">
            {ring?.percent == null ? '—' : ring.percent}
          </span>
        </div>
      </div>
      <div className="leading-tight">
        <div className="font-mono text-[12px] sm:text-[13px] font-bold tracking-[0.16em] uppercase" style={{ color: CYAN }}>{ring?.phase ?? ''}</div>
        <div className="font-mono text-[13px] sm:text-[14px] tabular-nums text-zinc-300 mt-0.5">{ring?.clock ?? ''}</div>
        <div className="font-mono text-[10px] text-zinc-500 mt-0.5">% of day</div>
      </div>
    </div>
  )
}

function Radar() {
  return (
    <div className="relative w-[76px] h-[76px] sm:w-[92px] sm:h-[92px] mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        {[18, 32, 46].map((r) => (
          <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="rgba(127,223,255,0.18)" strokeWidth="0.8" />
        ))}
        <line x1="50" y1="4" x2="50" y2="96" stroke="rgba(127,223,255,0.12)" strokeWidth="0.6" />
        <line x1="4" y1="50" x2="96" y2="50" stroke="rgba(127,223,255,0.12)" strokeWidth="0.6" />
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <g style={{ transformOrigin: '50px 50px', animation: 'hudRadar 4s linear infinite' }}>
          <path d="M50 50 L50 4 A46 46 0 0 1 90 32 Z" fill="url(#sweep)" />
        </g>
      </svg>
    </div>
  )
}

function StatRow({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="font-mono text-[10.5px] tracking-wide uppercase text-zinc-500 shrink-0">{k}</span>
      <span className="font-mono text-[12.5px] sm:text-[13.5px] font-semibold tabular-nums truncate text-right" style={{ color: accent ?? '#f4f4f5' }}>{v}</span>
    </div>
  )
}

// ── Energy curve — mirrors the circadian energy model from the Energy card,
//    with a dot that travels the curve (movement) + a "now" marker. ──
function energyAt(t: number) {
  const morning = 70 * Math.exp(-((t - 3) ** 2) / 20)
  const afternoon = 15 * Math.exp(-((t - 7) ** 2) / 4)
  const base = 35 - t * 1.8
  return Math.max(5, Math.min(95, base + morning - afternoon))
}

function EnergyCurve() {
  const { line, area, nowX, nowY, nowPct } = useMemo(() => {
    const W = 200, H = 46, total = 17
    const pts: [number, number][] = []
    for (let i = 0; i <= 48; i++) {
      const t = (i / 48) * total
      pts.push([(i / 48) * W, H - 5 - (energyAt(t) / 100) * (H - 12)])
    }
    const line = 'M ' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')
    const area = `${line} L ${W},${H} L 0,${H} Z`
    const now = new Date()
    const hoursAwake = Math.max(0, Math.min(total, now.getHours() + now.getMinutes() / 60 - 6.5))
    const e = energyAt(hoursAwake)
    return { line, area, nowX: (hoursAwake / total) * W, nowY: H - 5 - (e / 100) * (H - 12), nowPct: Math.round(e) }
  }, [])

  return (
    <>
      <svg viewBox="0 0 200 46" className="w-full h-12">
        <defs>
          <linearGradient id="enFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.26" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
          <path id="enPath" d={line} />
        </defs>
        <path d={area} fill="url(#enFill)" />
        <use href="#enPath" fill="none" stroke={CYAN} strokeWidth="1.4" opacity="0.9" />
        {/* traveling dot — the movement Luka likes */}
        <circle r="2.3" fill="#dff4ff">
          <animateMotion dur="7s" repeatCount="indefinite"><mpath href="#enPath" /></animateMotion>
        </circle>
        {/* current-time marker */}
        <circle cx={nowX} cy={nowY} r="3" fill="none" stroke="#fff" strokeWidth="1" />
        <circle cx={nowX} cy={nowY} r="1.4" fill="#fff" />
      </svg>
      <div className="flex items-center justify-between mt-1.5">
        <span className="font-mono text-[10px] tracking-wide text-zinc-400">NOW <span className="text-white tabular-nums">{nowPct}%</span></span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: VERDICT.GREEN, boxShadow: `0 0 6px ${VERDICT.GREEN}` }} />
          <span className="font-mono text-[9px] tracking-widest text-zinc-400">ONLINE</span>
        </span>
      </div>
    </>
  )
}

// ── decorative: live "raw data" hex readout ──
function RawData() {
  const [rows, setRows] = useState<string[]>([])
  useEffect(() => {
    const gen = () => Array.from({ length: 5 }, () =>
      Array.from({ length: 14 }, () => Math.floor(Math.random() * 16).toString(16)).join('').toUpperCase().replace(/(.{4})/g, '$1 ').trim())
    setRows(gen())
    const id = setInterval(() => setRows(gen()), 1400)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="space-y-0.5">
      {rows.map((r, i) => (
        <div key={i} className="font-mono text-[9px] tracking-wider text-zinc-600 tabular-nums">{r}</div>
      ))}
    </div>
  )
}

export default function HudOverlay() {
  const [ring, setRing] = useState<RingState | null>(null)
  const [stats, setStats] = useState<BentoStats | null>(null)
  const [call, setCall] = useState<TodaysCall | null>(null)

  useEffect(() => {
    setRing(computeRing())
    const id = setInterval(() => setRing(computeRing()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    fetch('/api/home/bento-stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: BentoStats & { error?: string }) => { if (!d.error) setStats(d) })
      .catch(() => {})
    fetch('/api/home/todays-call', { method: 'POST' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && !j.noData) setCall(j as TodaysCall) })
      .catch(() => {})
  }, [])

  // Prefer the recent check-in (current habit) over a possibly-stale formal log.
  const trainV = stats?.recentTrainingCheckin?.activity
    ? `${stats.recentTrainingCheckin.activity} · ${daysAgo(stats.recentTrainingCheckin.date + 'T12:00:00')}`
    : stats?.lastWorkout
      ? `${stats.lastWorkout.name ?? 'Workout'} · ${daysAgo(stats.lastWorkout.completedAt)}`
      : (stats?.workoutCount7d ?? 0) > 0 ? `${stats!.workoutCount7d}× this week` : '—'
  const recoveryV = stats?.recoveryScore != null ? `${stats.recoveryScore}%` : '—'
  const sleepV = stats?.sleepScore != null ? `${stats.sleepScore}` : '—'
  const fuelV = (stats?.todayCalories ?? 0) > 0
    ? `${stats!.todayCalories.toLocaleString()} cal · ${stats!.todayProtein}g`
    : '—'
  const recAccent = stats?.recoveryScore != null
    ? stats.recoveryScore >= 66 ? VERDICT.GREEN : stats.recoveryScore >= 34 ? VERDICT.YELLOW : VERDICT.RED
    : undefined

  return (
    <div className="pointer-events-none fixed inset-0 z-40 select-none">
      <div className="absolute inset-0" style={{
        background: 'repeating-linear-gradient(0deg, rgba(127,223,255,0.025) 0px, rgba(127,223,255,0.025) 1px, transparent 1px, transparent 3px)',
        opacity: 0.5,
      }} />
      <Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" />

      {/* LEFT column */}
      <div className="absolute left-3 sm:left-5 top-5 flex flex-col gap-3 w-[168px] sm:w-[250px]">
        <Panel label="Day"><DayArc ring={ring} /></Panel>
        <Panel label="Scan" className="hidden sm:block"><Radar /></Panel>
        {call && (
          <Panel label="Today's Call">
            <span className="inline-block font-mono text-[11px] font-bold tracking-widest px-2 py-0.5 rounded mb-2"
              style={{ color: VERDICT[call.color], background: `${VERDICT[call.color]}1f` }}>
              {call.color}
            </span>
            <p className="font-mono text-[13.5px] sm:text-[14.5px] font-semibold text-white leading-snug mb-2.5">{call.headline}</p>
            <ul className="space-y-1.5">
              {call.bullets.slice(0, 3).map((b, i) => (
                <li key={i} className="font-mono text-[11.5px] text-zinc-400 leading-relaxed">{b}</li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      {/* RIGHT column (below the view-toggle button) */}
      <div className="absolute right-3 sm:right-5 top-[64px] flex flex-col gap-3 w-[160px] sm:w-[238px]">
        <Panel label="Vitals">
          <div className="space-y-1.5">
            <StatRow k="Train" v={trainV} />
            <StatRow k="Recovery" v={recoveryV} accent={recAccent} />
            <StatRow k="Sleep" v={sleepV} />
            <StatRow k="Fuel" v={fuelV} />
          </div>
        </Panel>
        <Panel label="Energy" className="hidden sm:block">
          <EnergyCurve />
        </Panel>
        <Panel label="Raw Data" className="hidden sm:block"><RawData /></Panel>
      </div>

      <style>{`@keyframes hudRadar { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
    </div>
  )
}
