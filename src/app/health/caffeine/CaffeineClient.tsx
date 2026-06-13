'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useCaffeineLogs } from '@/features/health/queries'
import { useLogCaffeine, useDeleteCaffeineLog } from '@/features/health/mutations'
import type { CaffeineLog, OuraData, WhoopData } from '@/features/health/types'

// ── Pharmacokinetic model ────────────────────────────────────────────────────
const HALF_LIFE_H = 5.5      // caffeine half-life in hours
const ABSORPTION_TAU = 0.8   // absorption time constant (~45min to peak)
const ADENOSINE_RATE = 3.8   // sleep pressure units per hour awake
const CAF_SCALE = 0.13       // mg → energy units at peak

interface DosePoint {
  id: string
  hour: number
  mg: number
  source: string
  loggedAt: string
}

function caffeineConc(t: number, mg: number): number {
  if (t <= 0) return 0
  const absorption = 1 - Math.exp(-t / ABSORPTION_TAU)
  const decay = Math.exp(-t * Math.LN2 / HALF_LIFE_H)
  return mg * absorption * decay
}

function computeEnergy(
  hour: number,
  wakeHour: number,
  sleepQuality: number,
  doses: DosePoint[]
): number {
  if (hour < wakeHour - 1) return 0
  const hoursAwake = Math.max(0, hour - wakeHour)
  const baseline = 40 + sleepQuality * 0.28
  let cafEnergy = 0
  for (const d of doses) {
    cafEnergy += caffeineConc(hour - d.hour, d.mg) * CAF_SCALE
  }
  const pressure = hoursAwake * ADENOSINE_RATE
  return Math.max(0, Math.min(100, baseline + cafEnergy - pressure))
}

function energyLabel(e: number): string {
  if (e >= 80) return 'Peak'
  if (e >= 65) return 'High'
  if (e >= 50) return 'Moderate'
  if (e >= 35) return 'Low'
  return 'Crash'
}

function energyColor(e: number): string {
  if (e >= 65) return '#4ade80'
  if (e >= 45) return '#fb923c'
  return '#f87171'
}

function formatHour(h: number): string {
  const hr = Math.floor(h)
  const min = Math.round((h - hr) * 60)
  const suffix = hr < 12 ? 'am' : 'pm'
  const displayH = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
  return min > 0
    ? `${displayH}:${String(min).padStart(2, '0')}${suffix}`
    : `${displayH}${suffix}`
}

function formatHourShort(h: number): string {
  const hr = Math.floor(h)
  const displayH = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
  const suffix = hr < 12 ? 'a' : 'p'
  return `${displayH}${suffix}`
}

function formatHourRange(start: number, end: number): string {
  return `${formatHourShort(start)}–${formatHourShort(end)}`
}

function isoToHour(iso: string): number {
  const d = new Date(iso)
  return d.getHours() + d.getMinutes() / 60
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const hr = d.getHours()
  const min = d.getMinutes()
  const suffix = hr < 12 ? 'am' : 'pm'
  const h = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
  return `${h}:${String(min).padStart(2, '0')}${suffix}`
}

// ── Chart constants ───────────────────────────────────────────────────────────
const SVG_W = 800
const SVG_H = 160
const CHART_START_OFFSET = 1 // show 1h before wake

function hToX(h: number, wakeHour: number): number {
  const startH = wakeHour - CHART_START_OFFSET
  return ((h - startH) / (24 - startH)) * SVG_W
}

function eToY(e: number): number {
  return SVG_H - (e / 100) * SVG_H
}

// ── Dose presets ──────────────────────────────────────────────────────────────
const CAFFEINE_PRESETS = [
  { source: 'Coffee', amount_mg: 90 },
  { source: 'Pre-workout', amount_mg: 200 },
  { source: 'Energy drink', amount_mg: 150 },
  { source: 'Espresso', amount_mg: 60 },
] as const

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  initialCaffeine: CaffeineLog[]
  today: string
  ouraData: OuraData | null
  whoopData: WhoopData | null
}

export default function CaffeineClient({
  initialCaffeine,
  today,
  ouraData,
  whoopData,
}: Props) {
  // Normalize HRV to 0-100 scale (20ms = poor, 100ms = excellent)
  function normalizeHrv(hrv: number | null | undefined): number | null {
    if (hrv == null) return null
    return Math.min(100, Math.max(0, (hrv - 20) / 80 * 100))
  }

  // Derive sleep quality: blend composite score (70%) with HRV signal (30%)
  // Using whichever wearable has data, with 75 as the fallback.
  const sleepQuality = (() => {
    const ouraScore = ouraData?.sleep?.score
    const ouraHrv = normalizeHrv(ouraData?.sleep?.average_hrv)
    if (ouraScore != null) {
      return ouraHrv != null ? ouraScore * 0.7 + ouraHrv * 0.3 : ouraScore
    }
    const whoopScore = whoopData?.recovery?.score
    const whoopHrv = normalizeHrv(whoopData?.recovery?.hrv_rmssd_milli)
    if (whoopScore != null) {
      return whoopHrv != null ? whoopScore * 0.7 + whoopHrv * 0.3 : whoopScore
    }
    return 75
  })()
  // Derive wake hour from Oura bedtime_end (ISO 8601), fall back to 7am
  const wakeHour = (() => {
    const be = ouraData?.sleep?.bedtime_end
    if (be) {
      const d = new Date(be)
      if (!isNaN(d.getTime())) return d.getHours() + d.getMinutes() / 60
    }
    return 7
  })()

  // Live clock — updates every minute
  const [currentHour, setCurrentHour] = useState(() => {
    const now = new Date()
    return now.getHours() + now.getMinutes() / 60
  })
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date()
      setCurrentHour(now.getHours() + now.getMinutes() / 60)
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // Data
  const { data: caffeineLogs } = useCaffeineLogs(today, initialCaffeine)
  const logCaffeine = useLogCaffeine(today)
  const deleteCaffeine = useDeleteCaffeineLog(today)

  // Convert logs → dose points
  const doses: DosePoint[] = useMemo(
    () =>
      (caffeineLogs ?? [])
        .map(l => ({
          id: l.id,
          hour: isoToHour(l.logged_at),
          mg: l.amount_mg,
          source: l.source,
          loggedAt: l.logged_at,
        }))
        .sort((a, b) => a.hour - b.hour),
    [caffeineLogs]
  )

  const totalMg = doses.reduce((s, d) => s + d.mg, 0)
  const currentEnergy = useMemo(
    () => computeEnergy(currentHour, wakeHour, sleepQuality, doses),
    [currentHour, wakeHour, sleepQuality, doses]
  )

  // ── Chart curve paths ──────────────────────────────────────────────────────
  const { areaPath, linePts, timeLabelHours } = useMemo(() => {
    const startH = wakeHour - CHART_START_OFFSET
    const pts: [number, number][] = []
    for (let h = startH; h <= 24; h += 0.25) {
      const e = computeEnergy(h, wakeHour, sleepQuality, doses)
      pts.push([hToX(h, wakeHour), eToY(e)])
    }

    const linePts = pts
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(' ')

    const first = pts[0]
    const last = pts[pts.length - 1]
    let areaPath = `M ${first[0].toFixed(1)} ${SVG_H} L ${first[0].toFixed(1)} ${first[1].toFixed(1)}`
    for (let i = 1; i < pts.length; i++) {
      areaPath += ` L ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}`
    }
    areaPath += ` L ${last[0].toFixed(1)} ${SVG_H} Z`

    const timeLabelHours: number[] = []
    for (let h = Math.ceil(startH); h <= 24; h += 3) timeLabelHours.push(h)

    return { areaPath, linePts, timeLabelHours }
  }, [wakeHour, sleepQuality, doses])

  // ── Peak windows ───────────────────────────────────────────────────────────
  const peakWindows = useMemo(() => {
    const THRESHOLD = 62
    const wins: { start: number; end: number; peak: number; peakH: number }[] = []
    let inWin = false,
      winStart = 0,
      winPeak = 0,
      winPeakH = 0

    for (let h = wakeHour; h <= 24; h += 0.25) {
      const e = computeEnergy(h, wakeHour, sleepQuality, doses)
      if (e >= THRESHOLD && !inWin) {
        inWin = true
        winStart = h
        winPeak = e
        winPeakH = h
      } else if (e >= THRESHOLD && inWin) {
        if (e > winPeak) {
          winPeak = e
          winPeakH = h
        }
      } else if (e < THRESHOLD && inWin) {
        inWin = false
        if (h - winStart > 0.5)
          wins.push({
            start: winStart,
            end: h,
            peak: Math.round(winPeak),
            peakH: winPeakH,
          })
      }
    }
    if (inWin)
      wins.push({ start: winStart, end: 24, peak: Math.round(winPeak), peakH: winPeakH })
    return wins.sort((a, b) => b.peak - a.peak).slice(0, 3)
  }, [wakeHour, sleepQuality, doses])

  // ── Smart timing ───────────────────────────────────────────────────────────
  const { crashHour, lastCoffeeHour, peakFocusWindow } = useMemo(() => {
    // Predicted crash: next time energy drops below 50 after the next peak
    let crashHour: number | null = null
    let pastPeak = false
    let peakE = 0
    for (let h = currentHour; h <= 24; h += 0.25) {
      const e = computeEnergy(h, wakeHour, sleepQuality, doses)
      if (!pastPeak && e > peakE) peakE = e
      else if (!pastPeak && e < peakE - 5) pastPeak = true
      if (pastPeak && e < 50) {
        crashHour = h
        break
      }
    }

    // Last coffee by: binary search for latest dose time keeping caffeine < 25mg at 11pm
    let lo = wakeHour,
      hi = 23
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (caffeineConc(23 - mid, 100) < 25) lo = mid
      else hi = mid
    }

    const peakFocusWindow = peakWindows.find(w => w.end > currentHour) ?? null

    return { crashHour, lastCoffeeHour: lo, peakFocusWindow }
  }, [wakeHour, sleepQuality, doses, currentHour, peakWindows])

  // ── Chart scrub ────────────────────────────────────────────────────────────
  const chartRef = useRef<HTMLDivElement>(null)
  const [scrubHour, setScrubHour] = useState<number | null>(null)

  const handleChartMove = useCallback(
    (clientX: number) => {
      if (!chartRef.current) return
      const rect = chartRef.current.getBoundingClientRect()
      const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const startH = wakeHour - CHART_START_OFFSET
      setScrubHour(startH + relX * (24 - startH))
    },
    [wakeHour]
  )

  const displayHour = scrubHour ?? currentHour
  const displayEnergy =
    scrubHour !== null
      ? computeEnergy(scrubHour, wakeHour, sleepQuality, doses)
      : currentEnergy
  const color = energyColor(displayEnergy)
  const circumference = 2 * Math.PI * 38
  const ringOffset = circumference * (1 - displayEnergy / 100)

  const nowX = hToX(currentHour, wakeHour)
  const scrubX = scrubHour !== null ? hToX(scrubHour, wakeHour) : null
  const scrubY =
    scrubHour !== null
      ? eToY(computeEnergy(scrubHour, wakeHour, sleepQuality, doses))
      : null

  return (
    <main className="nebula-health min-h-screen pb-28 pt-4">
      {/* ── Header ── */}
      <div className="px-4 mb-5">
        <Link
          href="/health"
          className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.12em] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← HEALTH
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9px] font-mono text-green-400 tracking-[0.18em] mb-1">
              CAFFEINE · ENERGY
            </p>
            <h1 className="text-2xl font-bold text-white">Today&apos;s Curve</h1>
          </div>
          <div className="text-right">
            <p className="text-[9px] text-zinc-600 font-mono tracking-wider">
              {new Date()
                .toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })
                .toUpperCase()}
            </p>
            {ouraData?.sleep?.score != null && (
              <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                Sleep {ouraData.sleep.score} · Oura
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {/* ── Energy curve card ── */}
        <div className="cosmic-card p-4">
          {/* Score row */}
          <div className="flex items-start gap-4 mb-4">
            {/* Ring */}
            <div className="relative w-[76px] h-[76px] flex-shrink-0">
              <svg viewBox="0 0 90 90" className="w-full h-full">
                <circle
                  cx="45" cy="45" r="38"
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="5"
                />
                <circle
                  cx="45" cy="45" r="38"
                  fill="none"
                  stroke={color}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={circumference.toFixed(1)}
                  strokeDashoffset={ringOffset.toFixed(1)}
                  transform="rotate(-90 45 45)"
                  style={{
                    transition:
                      'stroke-dashoffset 400ms cubic-bezier(.16,1,.3,1), stroke 300ms',
                  }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="font-serif italic text-[22px] leading-none"
                  style={{ color }}
                >
                  {Math.round(displayEnergy)}
                </span>
                <span className="text-[8px] font-mono text-zinc-600 tracking-wider mt-0.5">
                  ENERGY
                </span>
              </div>
            </div>

            {/* State label */}
            <div className="pt-1 flex-1">
              <p className="text-lg font-semibold text-white">
                {energyLabel(displayEnergy)}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <div
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: color }}
                />
                <p className="text-[10px] text-zinc-400 font-mono">
                  {formatHour(displayHour)}
                </p>
                {scrubHour !== null && (
                  <span className="text-[9px] text-zinc-600 font-mono">
                    · Scrubbing
                  </span>
                )}
              </div>
            </div>

            {/* Total mg */}
            <div className="text-right pt-1">
              <p className="text-2xl font-bold text-white">{Math.round(totalMg)}</p>
              <p className="text-[10px] text-zinc-500">mg today</p>
            </div>
          </div>

          {/* Chart */}
          <div
            ref={chartRef}
            className="relative cursor-crosshair select-none"
            onMouseMove={e => handleChartMove(e.clientX)}
            onTouchMove={e => handleChartMove(e.touches[0].clientX)}
            onMouseLeave={() => setScrubHour(null)}
            onTouchEnd={() => setScrubHour(null)}
          >
            <svg
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              preserveAspectRatio="none"
              className="w-full"
              style={{ height: 140, display: 'block' }}
            >
              <defs>
                <linearGradient id="cafAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* 50% threshold line */}
              <line
                x1="0" y1={SVG_H * 0.5}
                x2={SVG_W} y2={SVG_H * 0.5}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth="1"
                strokeDasharray="4,6"
              />

              {/* Area fill */}
              <path d={areaPath} fill="url(#cafAreaGrad)" />

              {/* Line */}
              <polyline
                points={linePts}
                fill="none"
                stroke="#4ade80"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {/* Dose markers */}
              {doses.map(d => {
                const x = hToX(d.hour, wakeHour)
                const e = computeEnergy(d.hour, wakeHour, sleepQuality, doses)
                return (
                  <circle
                    key={d.id}
                    cx={x}
                    cy={eToY(e)}
                    r="4"
                    fill="#4ade80"
                    stroke="#050508"
                    strokeWidth="2"
                  />
                )
              })}

              {/* "Now" line */}
              <line
                x1={nowX} x2={nowX}
                y1="0" y2={SVG_H}
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1.5"
                strokeDasharray="2,4"
              />

              {/* Scrub line + dot */}
              {scrubX !== null && (
                <>
                  <line
                    x1={scrubX} x2={scrubX}
                    y1="0" y2={SVG_H}
                    stroke="rgba(255,255,255,0.5)"
                    strokeWidth="1"
                  />
                  {scrubY !== null && (
                    <circle
                      cx={scrubX}
                      cy={scrubY}
                      r="5"
                      fill={energyColor(displayEnergy)}
                      stroke="#050508"
                      strokeWidth="2"
                      style={{
                        filter: `drop-shadow(0 0 6px ${energyColor(displayEnergy)})`,
                      }}
                    />
                  )}
                </>
              )}
            </svg>

            {/* Time axis labels */}
            <div className="flex justify-between mt-1 px-0.5">
              {timeLabelHours.map(h => (
                <span key={h} className="text-[9px] font-mono text-zinc-700">
                  {formatHour(h)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Peak windows ── */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-green-400 tracking-[0.15em]">03</span>
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
              Peak Windows
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[9px] font-mono text-zinc-700">TODAY</span>
          </div>

          <div className="space-y-2">
            {peakWindows.length === 0 ? (
              <p className="py-3 text-center text-[11px] font-mono text-zinc-600">
                No peak windows today — add caffeine or improve sleep quality
              </p>
            ) : (
              peakWindows.map((w, i) => {
                const isActive = currentHour >= w.start && currentHour <= w.end
                const isPast = w.end < currentHour
                const stateLabel = isActive
                  ? '● IN IT NOW'
                  : isPast
                  ? 'PAST'
                  : `PEAKS ${formatHour(w.peakH).toUpperCase()}`

                return (
                  <div
                    key={i}
                    className={`flex items-center rounded-xl px-4 py-3 border transition-colors ${
                      isActive
                        ? 'bg-green-400/[0.05] border-green-400/30'
                        : 'bg-white/[0.03] border-white/[0.06]'
                    } ${isPast ? 'opacity-45' : ''}`}
                  >
                    <div className="flex-1">
                      <p className="font-serif italic text-xl text-green-400">
                        {formatHourRange(w.start, w.end)}
                      </p>
                      <p
                        className={`text-[9px] font-mono mt-0.5 tracking-[0.12em] ${
                          isActive ? 'text-green-400' : 'text-zinc-500'
                        }`}
                      >
                        {stateLabel}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-mono text-zinc-600 tracking-[0.12em]">PEAK</p>
                      <p className="font-serif italic text-2xl text-white leading-none">
                        {w.peak}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ── Smart timing ── */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-green-400 tracking-[0.15em]">04</span>
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
              Smart Timing
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            {/* Peak focus */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">
                Peak Focus
              </p>
              <p className="font-serif italic text-base text-green-400 leading-tight">
                {peakFocusWindow
                  ? formatHourRange(peakFocusWindow.start, peakFocusWindow.end)
                  : 'None left'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">
                {peakFocusWindow ? `Score ${peakFocusWindow.peak}` : 'All windows past'}
              </p>
            </div>

            {/* Predicted crash */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">
                Predicted Crash
              </p>
              <p
                className={`font-serif italic text-base leading-tight ${
                  crashHour && crashHour - currentHour < 2
                    ? 'text-orange-400'
                    : 'text-white'
                }`}
              >
                {crashHour ? `~${formatHour(crashHour)}` : 'After midnight'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">Energy drops below 50</p>
            </div>

            {/* Last coffee by */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">
                Last Coffee By
              </p>
              <p
                className={`font-serif italic text-base leading-tight ${
                  lastCoffeeHour < currentHour ? 'text-orange-400' : 'text-sky-400'
                }`}
              >
                {formatHour(lastCoffeeHour)}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">&lt;25mg at 11pm bedtime</p>
            </div>
          </div>
        </div>

        {/* ── Dose logger ── */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-green-400 tracking-[0.15em]">02</span>
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">
              Log Dose
            </span>
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[9px] font-mono text-zinc-600">
              {Math.round(totalMg)}mg total
            </span>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {CAFFEINE_PRESETS.map(preset => (
              <button
                key={preset.source}
                onClick={() =>
                  logCaffeine.mutate({
                    source: preset.source,
                    amount_mg: preset.amount_mg,
                  })
                }
                disabled={logCaffeine.isPending}
                className="rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-white active:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {preset.source}{' '}
                <span className="text-zinc-400">{preset.amount_mg}mg</span>
              </button>
            ))}
          </div>

          {(caffeineLogs?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {[...(caffeineLogs ?? [])].reverse().map(log => (
                <div key={log.id} className="flex items-center gap-3">
                  <span className="w-16 text-xs font-mono text-zinc-500">
                    {formatTime(log.logged_at)}
                  </span>
                  <span className="flex-1 text-xs text-zinc-300">{log.source}</span>
                  <span className="text-xs text-zinc-500">{log.amount_mg}mg</span>
                  <button
                    onClick={() => deleteCaffeine.mutate(log.id)}
                    className="px-1 text-sm text-zinc-600 active:text-zinc-400"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] font-mono text-zinc-700">
              No doses logged today
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
