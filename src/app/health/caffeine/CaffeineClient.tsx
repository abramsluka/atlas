'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useCaffeineLogs } from '@/features/health/queries'
import { useLogCaffeine, useDeleteCaffeineLog } from '@/features/health/mutations'
import type { CaffeineLog, OuraData, WhoopData } from '@/features/health/types'
import type { WorkoutPoint, MealPoint } from './page'
import {
  caffeineConc,
  circadianOffset,
  workoutBoostAt,
  mealDipAt,
  computeEnergy,
  energyLabel,
  energyColor,
  deriveSleepQuality,
  deriveWakeHour,
  computePeakWindows,
  CAF_SCALE,
  ADENOSINE_RATE,
  type DosePoint,
} from '@/features/health/energyModel'

interface EnergyRating {
  id: string
  logged_at: string
  rating: number
  predicted: number | null
}

const DOSE_COLORS = ['#4ade80', '#60a5fa', '#fb923c', '#c084fc', '#f472b6', '#34d399']

// Change 1: formatHourShort now includes minutes when non-zero
function formatHourShort(h: number): string {
  const hr = Math.floor(h)
  const min = Math.round((h - hr) * 60)
  const displayH = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr
  const suffix = hr < 12 ? 'a' : 'p'
  return min > 0
    ? `${displayH}:${String(min).padStart(2, '0')}${suffix}`
    : `${displayH}${suffix}`
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

function nowTimeString(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

// ── Chart constants ───────────────────────────────────────────────────────────
const SVG_W = 800
const SVG_H = 220
const CHART_START_OFFSET = 1

function hToX(h: number, wakeHour: number): number {
  const startH = wakeHour - CHART_START_OFFSET
  return ((h - startH) / (24 - startH)) * SVG_W
}

function eToY(e: number): number {
  return SVG_H - (e / 100) * SVG_H
}

function eToYScaled(e: number, yMin: number, yMax: number): number {
  return SVG_H - ((e - yMin) / Math.max(1, yMax - yMin)) * SVG_H
}

// ── Dose modal presets ────────────────────────────────────────────────────────
const MODAL_PRESETS = [
  { source: 'Espresso', amount_mg: 75 },
  { source: 'Coffee', amount_mg: 100 },
  { source: 'Large coffee', amount_mg: 150 },
  { source: 'Double shot', amount_mg: 200 },
  { source: 'Tea', amount_mg: 80 },
  { source: 'Energy drink', amount_mg: 150 },
]

// ── Quick-log presets (bottom card) ──────────────────────────────────────────
const CAFFEINE_PRESETS = [
  { source: 'Coffee', amount_mg: 90 },
  { source: 'Pre-workout', amount_mg: 200 },
  { source: 'Energy drink', amount_mg: 150 },
  { source: 'Espresso', amount_mg: 60 },
] as const

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  initialCaffeine: CaffeineLog[]
  initialRatings: EnergyRating[]
  today: string
  ouraData: OuraData | null
  whoopData: WhoopData | null
  workouts: WorkoutPoint[]
  meals: MealPoint[]
}

export default function CaffeineClient({ initialCaffeine, initialRatings, today, ouraData, whoopData, workouts, meals }: Props) {
  const qc = useQueryClient()
  // ── Model inputs ──────────────────────────────────────────────────────────
  const sleepQuality = deriveSleepQuality(ouraData, whoopData)
  const wakeHour = deriveWakeHour(ouraData)

  // ── Live clock ────────────────────────────────────────────────────────────
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

  // ── Data ─────────────────────────────────────────────────────────────────
  const { data: caffeineLogs } = useCaffeineLogs(today, initialCaffeine)
  const logCaffeine = useLogCaffeine(today)
  const deleteCaffeine = useDeleteCaffeineLog(today)

  // ── Energy ratings ────────────────────────────────────────────────────────
  const { data: ratings = initialRatings } = useQuery<EnergyRating[]>({
    queryKey: ['energy-ratings', today],
    queryFn: () => fetch(`/api/health/energy-rating?date=${today}`).then(r => r.json()),
    initialData: initialRatings,
    staleTime: 30_000,
  })

  const [ratingSlider, setRatingSlider] = useState(50)
  const [ratingSaved, setRatingSaved] = useState(false)
  const [totalDays, setTotalDays] = useState(0)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch('/api/health/energy-rating?count=true')
      .then(r => r.json())
      .then(({ count }: { count: number }) => setTotalDays(count))
      .catch(() => {})
  }, [])

  function handleRatingChange(val: number) {
    setRatingSlider(val)
    setRatingSaved(false)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      await fetch('/api/health/energy-rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: val, predicted: Math.round(currentEnergy), date_key: today }),
      })
      qc.invalidateQueries({ queryKey: ['energy-ratings', today] })
      setRatingSaved(true)
      setTimeout(() => setRatingSaved(false), 2000)
    }, 800)
  }

  const doses: DosePoint[] = useMemo(
    () =>
      (caffeineLogs ?? [])
        .map(l => ({ id: l.id, hour: isoToHour(l.logged_at), mg: l.amount_mg, source: l.source, loggedAt: l.logged_at }))
        .sort((a, b) => a.hour - b.hour),
    [caffeineLogs]
  )

  const totalMg = doses.reduce((s, d) => s + d.mg, 0)

  const currentEnergy = useMemo(
    () => computeEnergy(currentHour, wakeHour, sleepQuality, doses, workouts, meals),
    [currentHour, wakeHour, sleepQuality, doses, workouts, meals]
  )

  // ── Chart paths ───────────────────────────────────────────────────────────
  const { areaPath, linePath, timeLabelHours, chartYMin, chartYMax } = useMemo(() => {
    const startH = wakeHour - CHART_START_OFFSET
    // Fine-grained pass for accurate Y-scale bounds
    const allEnergies: number[] = []
    for (let h = startH; h <= 24; h += 0.25) {
      allEnergies.push(computeEnergy(h, wakeHour, sleepQuality, doses, workouts, meals))
    }
    const dataMin = Math.min(...allEnergies)
    const dataMax = Math.max(...allEnergies)
    const pad = Math.max(6, (dataMax - dataMin) * 0.22)
    const chartYMin = Math.max(0, dataMin - pad)
    const chartYMax = Math.min(100, dataMax + pad)

    // 0.5h grid + exact dose hours so the curve always passes through dose positions
    const sampleSet = new Set<number>()
    for (let h = startH; h <= 24; h += 0.5) sampleSet.add(Math.round(h * 1000) / 1000)
    for (const d of doses) sampleSet.add(Math.round(d.hour * 1000) / 1000)
    const sampleHours = Array.from(sampleSet).sort((a, b) => a - b)

    const pts: [number, number][] = sampleHours.map(h => {
      const e = computeEnergy(h, wakeHour, sleepQuality, doses, workouts, meals)
      return [hToX(h, wakeHour), eToYScaled(e, chartYMin, chartYMax)]
    })

    // Catmull-Rom → smooth curve that passes through all points without overshooting
    function catmullPath(points: [number, number][]) {
      let d = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)]
        const p1 = points[i]
        const p2 = points[i + 1]
        const p3 = points[Math.min(points.length - 1, i + 2)]
        const cp1x = p1[0] + (p2[0] - p0[0]) / 6
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6
        const cp2x = p2[0] - (p3[0] - p1[0]) / 6
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
      }
      return d
    }

    const linePath = catmullPath(pts)
    const areaPath = `M ${pts[0][0].toFixed(1)} ${SVG_H} L ` +
      catmullPath(pts).slice(1) +
      ` L ${pts[pts.length - 1][0].toFixed(1)} ${SVG_H} Z`

    const timeLabelHours: number[] = []
    for (let h = Math.ceil(startH); h <= 24; h += 3) timeLabelHours.push(h)
    return { areaPath, linePath, timeLabelHours, chartYMin, chartYMax }
  }, [wakeHour, sleepQuality, doses, workouts, meals])

  // ── Peak windows ─────────────────────────────────────────────────────────
  // Local maxima of the curve (tight window per bump), not one wide span.
  const peakWindows = useMemo(
    () => computePeakWindows(wakeHour, sleepQuality, doses, workouts, meals),
    [wakeHour, sleepQuality, doses, workouts, meals]
  )

  // ── Smart timing ─────────────────────────────────────────────────────────
  const { crashHour, lastCoffeeHour, peakFocusWindow } = useMemo(() => {
    let crashHour: number | null = null, pastPeak = false, peakE = 0
    for (let h = currentHour; h <= 24; h += 0.25) {
      const e = computeEnergy(h, wakeHour, sleepQuality, doses, workouts, meals)
      if (!pastPeak && e > peakE) peakE = e
      else if (!pastPeak && e < peakE - 5) pastPeak = true
      if (pastPeak && e < 50) { crashHour = h; break }
    }
    let lo = wakeHour, hi = 23
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2
      if (caffeineConc(23 - mid, 100) < 25) lo = mid; else hi = mid
    }
    const peakFocusWindow = peakWindows.find(w => w.end > currentHour) ?? null
    return { crashHour, lastCoffeeHour: lo, peakFocusWindow }
  }, [wakeHour, sleepQuality, doses, workouts, meals, currentHour, peakWindows])

  // ── Model contributors at current hour ────────────────────────────────────
  const contributors = useMemo(() => {
    if (currentHour < wakeHour) return []
    const hoursAwake = Math.max(0, currentHour - wakeHour)
    const cafTotal = doses.reduce((s, d) => s + caffeineConc(currentHour - d.hour, d.mg) * CAF_SCALE, 0)
    const circ = circadianOffset(currentHour)
    const workout = workoutBoostAt(currentHour, workouts)
    const mealNow = mealDipAt(currentHour, meals)
    const adenosine = -(hoursAwake * ADENOSINE_RATE)

    // Find the peak meal dip across the whole day (so it shows even after the window passes)
    let peakMealDip = 0
    for (let h = wakeHour; h <= 24; h += 0.25) {
      const d = mealDipAt(h, meals)
      if (d < peakMealDip) peakMealDip = d
    }
    const mealValue = mealNow < -1 ? mealNow : peakMealDip // prefer live value, fall back to peak

    const items: { label: string; value: number; color: string; past?: boolean }[] = []
    if (cafTotal > 1)       items.push({ label: 'Caffeine',      value: Math.round(cafTotal),  color: '#4ade80' })
    if (workout > 1)        items.push({ label: 'Workout',       value: Math.round(workout),   color: '#60a5fa' })
    if (circ > 1)           items.push({ label: 'Second wind',   value: Math.round(circ),      color: '#c084fc' })
    if (circ < -1)          items.push({ label: 'Afternoon dip', value: Math.round(circ),      color: '#fb923c' })
    if (mealValue < -1)     items.push({ label: 'Meal dip',      value: Math.round(peakMealDip), color: '#f87171', past: mealNow > -1 })
    items.push({             label: 'Adenosine',                  value: Math.round(adenosine), color: '#52525b' })
    return items
  }, [currentHour, wakeHour, doses, workouts, meals])

  // ── Chart scrub ───────────────────────────────────────────────────────────
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
  const displayEnergy = scrubHour !== null ? computeEnergy(scrubHour, wakeHour, sleepQuality, doses, workouts, meals) : currentEnergy
  const color = energyColor(displayEnergy)
  const circumference = 2 * Math.PI * 38
  const ringOffset = circumference * (1 - displayEnergy / 100)

  const nowX = hToX(currentHour, wakeHour)
  const scrubX = scrubHour !== null ? hToX(scrubHour, wakeHour) : null
  const scrubY = scrubHour !== null ? eToYScaled(computeEnergy(scrubHour, wakeHour, sleepQuality, doses, workouts, meals), chartYMin, chartYMax) : null
  const scrubXPct = scrubX !== null ? (scrubX / SVG_W) * 100 : null

  // ── Dose modal state ──────────────────────────────────────────────────────
  const [doseModalOpen, setDoseModalOpen] = useState(false)
  const [modalTime, setModalTime] = useState(nowTimeString)
  const [modalPresetIdx, setModalPresetIdx] = useState(1) // Coffee 100mg default
  const [modalLabel, setModalLabel] = useState('Coffee')

  function openModal() {
    setModalTime(nowTimeString())
    setModalPresetIdx(1)
    setModalLabel(MODAL_PRESETS[1].source)
    setDoseModalOpen(true)
  }

  function handleModalPresetChange(idx: number) {
    setModalPresetIdx(idx)
    setModalLabel(MODAL_PRESETS[idx].source)
  }

  function handleModalAdd() {
    const [hStr, mStr] = modalTime.split(':')
    const h = parseInt(hStr, 10), m = parseInt(mStr, 10)
    if (isNaN(h) || isNaN(m)) return
    const now = new Date()
    const logged = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
    logCaffeine.mutate({
      source: modalLabel || MODAL_PRESETS[modalPresetIdx].source,
      amount_mg: MODAL_PRESETS[modalPresetIdx].amount_mg,
      logged_at: logged.toISOString(),
    })
    setDoseModalOpen(false)
  }

  // ── Dose timeline data ────────────────────────────────────────────────────
  const timelineStartH = wakeHour
  const timelineEndH = 24
  const totalActiveMg = doses.reduce((s, d) => s + caffeineConc(currentHour - d.hour, d.mg), 0)
  const maxPossibleMg = Math.max(totalMg, 1)

  // ── Dose stack paths ──────────────────────────────────────────────────────
  const STACK_SVG_H = 120
  const doseStackPaths = useMemo(() => {
    if (doses.length === 0) return []
    const startH = wakeHour - CHART_START_OFFSET
    const maxMg = Math.max(...doses.map(d => d.mg), 1)
    return doses.map((d, i) => {
      const pts: [number, number][] = []
      for (let h = startH; h <= 24; h += 0.25) {
        const mg = caffeineConc(h - d.hour, d.mg)
        const x = hToX(h, wakeHour)
        const y = STACK_SVG_H - (mg / maxMg) * STACK_SVG_H
        pts.push([x, y])
      }
      const linePts = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
      const first = pts[0], last = pts[pts.length - 1]
      let areaPath = `M ${first[0].toFixed(1)} ${STACK_SVG_H} L ${first[0].toFixed(1)} ${first[1].toFixed(1)}`
      for (let j = 1; j < pts.length; j++) areaPath += ` L ${pts[j][0].toFixed(1)} ${pts[j][1].toFixed(1)}`
      areaPath += ` L ${last[0].toFixed(1)} ${STACK_SVG_H} Z`
      return { linePts, areaPath, color: DOSE_COLORS[i % DOSE_COLORS.length], dose: d }
    })
  }, [doses, wakeHour])

  return (
    <main className="nebula-health min-h-screen pb-28 pt-4">
      {/* ── Header ── */}
      <div className="px-4 mb-5" style={{ position: 'relative', zIndex: 10 }}>
        <Link
          href="/health"
          className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-mono tracking-[0.12em] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          ← HEALTH
        </Link>

        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div>
            {/* Change 6: renamed subtitle */}
            <p className="text-[9px] font-mono text-green-400 tracking-[0.18em] mb-1">ENERGY</p>
            <h1 className="text-2xl font-bold text-white">Today&apos;s Curve</h1>
          </div>

          {/* Right cluster: dose chips + add button + date/oura */}
          <div className="flex flex-col items-end gap-2 pt-0.5">
            {/* Dose chips + modal trigger — relative so dropdown anchors here */}
            <div className="relative">
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {doses.map(d => (
                  <div
                    key={d.id}
                    className="flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.05] px-2 py-1"
                  >
                    <span className="font-mono text-[11px] text-zinc-300">
                      {formatHourShort(d.hour)} {d.mg}mg
                    </span>
                    <button
                      onClick={() => deleteCaffeine.mutate(d.id)}
                      className="text-zinc-600 hover:text-zinc-400 transition-colors leading-none ml-0.5"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={openModal}
                  className="rounded-full border border-green-500/40 bg-green-500/15 px-3 py-1 font-mono text-[11px] text-green-400 active:bg-green-500/25 transition-colors"
                >
                  + DOSE
                </button>
              </div>

              {/* Dropdown modal — fixed so stacking contexts can't trap it */}
              {doseModalOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setDoseModalOpen(false)} />
                  <div
                    style={{
                      position: 'fixed',
                      top: 88,
                      right: 16,
                      zIndex: 9999,
                      width: 288,
                      background: '#0a0a0d',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 16,
                      padding: 16,
                      boxShadow: '0 20px 60px rgba(0,0,0,0.98)',
                      isolation: 'isolate',
                      opacity: 1,
                    }}
                  >
                    <p className="text-[9px] font-mono text-zinc-600 tracking-[0.2em] uppercase mb-3">Add Dose</p>
                    <div className="space-y-3">
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 tracking-[0.15em] uppercase mb-1.5">Time</p>
                        <input
                          type="time"
                          value={modalTime}
                          onChange={e => setModalTime(e.target.value)}
                          style={{ background: '#131316', colorScheme: 'dark' }}
                          className="w-full rounded-[10px] border border-white/[0.08] px-3 py-2 text-sm font-mono text-white outline-none focus:border-white/25"
                        />
                      </div>
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 tracking-[0.15em] uppercase mb-1.5">Caffeine (mg)</p>
                        <select
                          value={modalPresetIdx}
                          onChange={e => handleModalPresetChange(Number(e.target.value))}
                          style={{ background: '#131316' }}
                          className="w-full rounded-[10px] border border-white/[0.08] px-3 py-2 text-sm text-white outline-none focus:border-white/25"
                        >
                          {MODAL_PRESETS.map((p, i) => (
                            <option key={p.source} value={i} style={{ background: '#131316' }}>{p.source} · {p.amount_mg}mg</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <p className="text-[9px] font-mono text-zinc-500 tracking-[0.15em] uppercase mb-1.5">Label</p>
                        <input
                          type="text"
                          value={modalLabel}
                          onChange={e => setModalLabel(e.target.value)}
                          style={{ background: '#131316' }}
                          className="w-full rounded-[10px] border border-white/[0.08] px-3 py-2 text-sm text-white placeholder-zinc-700 outline-none focus:border-white/25"
                          placeholder="e.g. Coffee"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => setDoseModalOpen(false)}
                        style={{ background: '#1a1a1e' }}
                        className="flex-1 rounded-[10px] border border-white/[0.08] py-2.5 text-sm font-semibold text-zinc-400 active:opacity-70"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleModalAdd}
                        disabled={logCaffeine.isPending}
                        className="flex-1 rounded-[10px] bg-green-500 py-2.5 text-sm font-bold text-black active:opacity-80 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Date + Oura */}
            <div className="text-right">
              <p className="text-[9px] text-zinc-600 font-mono tracking-wider">
                {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
              </p>
              {ouraData?.sleep?.score != null && (
                <p className="text-[10px] text-zinc-500 font-mono">
                  Sleep {ouraData.sleep.score} · Oura
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {/* ── Energy curve card ── */}
        <div className="cosmic-card p-4">
          <div className="flex items-start gap-4 mb-4">
            {/* Ring */}
            <div className="relative w-[76px] h-[76px] flex-shrink-0">
              <svg viewBox="0 0 90 90" className="w-full h-full">
                <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="5" />
                <circle
                  cx="45" cy="45" r="38" fill="none"
                  stroke={color} strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={circumference.toFixed(1)} strokeDashoffset={ringOffset.toFixed(1)}
                  transform="rotate(-90 45 45)"
                  style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(.16,1,.3,1), stroke 300ms' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-serif italic text-[22px] leading-none" style={{ color }}>
                  {Math.round(displayEnergy)}
                </span>
                <span className="text-[8px] font-mono text-zinc-600 tracking-wider mt-0.5">ENERGY</span>
              </div>
            </div>

            {/* State label */}
            <div className="pt-1 flex-1">
              <p className="text-lg font-semibold text-white">{energyLabel(displayEnergy)}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <p className="text-[10px] text-zinc-400 font-mono">{formatHour(displayHour)}</p>
              </div>
              <p className="text-[9px] font-mono text-zinc-600 mt-1.5">
                {ouraData?.sleep?.score != null
                  ? `Sleep ${ouraData.sleep.score} · wake ${formatHour(wakeHour)}`
                  : whoopData?.recovery?.score != null
                  ? `Recovery ${whoopData.recovery.score} · wake ${formatHour(wakeHour)}`
                  : `Baseline sleep · wake ${formatHour(wakeHour)}`}
              </p>
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
            <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} preserveAspectRatio="none" className="w-full" style={{ height: 200, display: 'block' }}>
              <defs>
                <linearGradient id="cafAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4ade80" stopOpacity="0.45" />
                  <stop offset="60%" stopColor="#4ade80" stopOpacity="0.12" />
                  <stop offset="100%" stopColor="#4ade80" stopOpacity="0.01" />
                </linearGradient>
              </defs>
              {/* Subtle horizontal grid lines */}
              {[0.25, 0.5, 0.75].map(f => (
                <line key={f} x1="0" y1={SVG_H * f} x2={SVG_W} y2={SVG_H * f} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
              ))}
              <path d={areaPath} fill="url(#cafAreaGrad)" />
              <path d={linePath} fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {doses.map(d => (
                <circle key={d.id} cx={hToX(d.hour, wakeHour)} cy={eToYScaled(computeEnergy(d.hour, wakeHour, sleepQuality, doses, workouts, meals), chartYMin, chartYMax)} r="4.5" fill="#050508" stroke="#4ade80" strokeWidth="2" />
              ))}
              <line x1={nowX} x2={nowX} y1="0" y2={SVG_H} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeDasharray="3,5" />
              {scrubX !== null && (
                <>
                  <line x1={scrubX} x2={scrubX} y1="0" y2={SVG_H} stroke="rgba(255,255,255,0.45)" strokeWidth="1" strokeDasharray="3,5" />
                  {scrubY !== null && (
                    <circle cx={scrubX} cy={scrubY} r="5" fill={energyColor(displayEnergy)} stroke="#050508" strokeWidth="2"
                      style={{ filter: `drop-shadow(0 0 8px ${energyColor(displayEnergy)})` }}
                    />
                  )}
                </>
              )}
            </svg>

            {/* Change 7: floating scrub tooltip card */}
            {scrubX !== null && scrubY !== null && scrubXPct !== null && (
              <div
                className="pointer-events-none absolute"
                style={{
                  ...(scrubXPct > 65
                    ? { right: `${100 - scrubXPct}%`, transform: 'translateX(-12px) translateY(-50%)' }
                    : { left: `${scrubXPct}%`, transform: 'translateX(12px) translateY(-50%)' }),
                  top: `${(scrubY / SVG_H) * 100}%`,
                }}
              >
                <div style={{
                  background: 'rgba(10,10,14,0.92)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  borderRadius: 12,
                  padding: '6px 12px',
                  backdropFilter: 'blur(8px)',
                  minWidth: 68,
                }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 28, color: energyColor(displayEnergy), lineHeight: 1 }}>
                    {Math.round(displayEnergy)}
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                    {formatHour(scrubHour!)}
                  </div>
                </div>
              </div>
            )}

            {/* Time axis */}
            <div className="flex justify-between mt-1 px-0.5">
              {timeLabelHours.map(h => (
                <span key={h} className="text-[9px] font-mono text-zinc-700">{formatHour(h)}</span>
              ))}
            </div>
          </div>
        </div>

        {/* ── A4: Model contributors ── */}
        {contributors.length > 0 && (
          <div className="cosmic-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">What&apos;s Driving This</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[9px] font-mono text-zinc-700">{formatHour(currentHour)}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {contributors.map(c => (
                <div key={c.label} className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.04] px-3 py-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                  <span className="text-[10px] font-mono text-zinc-400">{c.label}</span>
                  <span
                    className="text-[10px] font-mono font-semibold"
                    style={{ color: c.value >= 0 ? c.color : '#f87171' }}
                  >
                    {c.value >= 0 ? `+${c.value}` : c.value}
                  </span>
                  {'past' in c && c.past && (
                    <span className="text-[8px] font-mono text-zinc-600 ml-0.5">peak</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── How do you feel? ── */}
        <div style={{ background: '#0a0a0d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 18px' }}>
          <div className="flex items-center gap-4">
            {/* Left: label */}
            <div style={{ flexShrink: 0, width: '36%' }}>
              <p style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontWeight: 700, fontSize: 19, color: 'white', lineHeight: 1.2 }}>
                How do you feel right now?
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#52525b', letterSpacing: '0.13em', marginTop: 4, textTransform: 'uppercase' }}>
                Currently building a more detailed analysis · {totalDays}/30 days
              </p>
            </div>

            {/* Middle: gradient slider */}
            <div className="relative flex items-center" style={{ flex: 1, height: 32 }}>
              <div className="absolute inset-x-0" style={{ height: 7, borderRadius: 4, background: 'linear-gradient(to right, #ef4444, #f97316 35%, #eab308 65%, #4ade80)' }} />
              <div
                className="absolute pointer-events-none"
                style={{
                  left: `calc(${ratingSlider}% - 12px)`,
                  width: 24, height: 24, borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 0 0 3px rgba(74,222,128,0.4), 0 0 16px rgba(74,222,128,0.6)',
                }}
              />
              <input
                type="range" min={0} max={100} step={1}
                value={ratingSlider}
                onChange={e => handleRatingChange(Number(e.target.value))}
                className="absolute inset-0 w-full cursor-pointer"
                style={{ height: '100%', opacity: 0 }}
              />
            </div>

            {/* Right: percentage */}
            <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 52 }}>
              <span style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 30, color: 'white', lineHeight: 1 }}>
                {ratingSlider}%
              </span>
              {ratingSaved && (
                <p style={{ fontFamily: 'monospace', fontSize: 8, color: '#4ade80', marginTop: 2, letterSpacing: '0.1em' }}>SAVED</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Peak windows ── (Change 2: no number prefix) */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Peak Windows</span>
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
                const stateLabel = isActive ? '● IN IT NOW' : isPast ? 'PAST' : `PEAKS ${formatHour(w.peakH).toUpperCase()}`
                return (
                  <div key={i} className={`flex items-center rounded-xl px-4 py-3 border transition-colors ${isActive ? 'bg-green-400/[0.05] border-green-400/30' : 'bg-white/[0.03] border-white/[0.06]'} ${isPast ? 'opacity-45' : ''}`}>
                    <div className="flex-1">
                      <p className="font-serif italic text-xl text-green-400">{formatHourRange(w.start, w.end)}</p>
                      <p className={`text-[9px] font-mono mt-0.5 tracking-[0.12em] ${isActive ? 'text-green-400' : 'text-zinc-500'}`}>{stateLabel}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-mono text-zinc-600 tracking-[0.12em]">PEAK</p>
                      <p className="font-serif italic text-2xl text-white leading-none">{w.peak}</p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ── Smart timing ── (Change 2: no number prefix) */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Smart Timing</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">Peak Focus</p>
              <p className="font-serif italic text-base text-green-400 leading-tight">
                {peakFocusWindow ? formatHourRange(peakFocusWindow.start, peakFocusWindow.end) : 'None left'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">
                {peakFocusWindow ? `Score ${peakFocusWindow.peak}` : 'All windows past'}
              </p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">Predicted Crash</p>
              <p className={`font-serif italic text-base leading-tight ${crashHour && crashHour - currentHour < 2 ? 'text-orange-400' : 'text-white'}`}>
                {crashHour ? `~${formatHour(crashHour)}` : 'After midnight'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">Energy drops below 50</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
              <p className="text-[8px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-1.5">Last Coffee By</p>
              <p className={`font-serif italic text-base leading-tight ${lastCoffeeHour < currentHour ? 'text-orange-400' : 'text-sky-400'}`}>
                {formatHour(lastCoffeeHour)}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">&lt;25mg at 11pm bedtime</p>
            </div>
          </div>
        </div>

        {/* ── Change 8: Dose Timeline ── */}
        {doses.length > 0 && (
          <div className="cosmic-card p-4">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Dose Timeline</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Timeline track */}
            <div className="relative h-8 mb-1">
              {/* Track line */}
              <div className="absolute top-1/2 left-0 right-0 h-px bg-white/[0.10]" style={{ transform: 'translateY(-50%)' }} />
              {/* Dose dots */}
              {doses.map((d, i) => {
                const pct = ((d.hour - timelineStartH) / (timelineEndH - timelineStartH)) * 100
                const clampedPct = Math.max(0, Math.min(98, pct))
                return (
                  <div key={d.id} className="absolute top-0 flex flex-col items-center" style={{ left: `${clampedPct}%`, transform: 'translateX(-50%)' }}>
                    <span className="text-[9px] font-mono whitespace-nowrap mb-0.5" style={{ color: DOSE_COLORS[i % DOSE_COLORS.length] }}>
                      {d.source} · {d.mg}mg
                    </span>
                    <div className="w-2.5 h-2.5 rounded-full border-2 border-[#050508]" style={{ background: DOSE_COLORS[i % DOSE_COLORS.length] }} />
                  </div>
                )
              })}
              {/* NOW marker */}
              {currentHour >= timelineStartH && currentHour <= timelineEndH && (
                <div
                  className="absolute top-0 bottom-0 flex flex-col items-center justify-end"
                  style={{ left: `${((currentHour - timelineStartH) / (timelineEndH - timelineStartH)) * 100}%`, transform: 'translateX(-50%)' }}
                >
                  <div className="w-px h-full bg-white/30" />
                  <span className="text-[8px] font-mono text-zinc-500 mt-0.5">NOW</span>
                </div>
              )}
            </div>

            {/* Time labels */}
            <div className="flex justify-between mb-4">
              {[wakeHour, 12, 15, 18, 21, 24].filter(h => h >= wakeHour).map(h => (
                <span key={h} className="text-[9px] font-mono text-zinc-700">{formatHourShort(h)}</span>
              ))}
            </div>

            {/* Active mg bars */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-24 text-[9px] font-mono text-zinc-500 uppercase tracking-wider shrink-0">Total Active</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-400 transition-all duration-1000"
                    style={{ width: `${Math.min(100, (totalActiveMg / maxPossibleMg) * 100)}%` }}
                  />
                </div>
                <span className="text-[10px] font-mono text-zinc-400 w-10 text-right">{Math.round(totalActiveMg)}mg</span>
              </div>
              {doses.map((d, i) => {
                const active = caffeineConc(currentHour - d.hour, d.mg)
                return (
                  <div key={d.id} className="flex items-center gap-3">
                    <span className="w-24 text-[9px] font-mono text-zinc-600 truncate shrink-0">
                      {formatHourShort(d.hour)} · {d.source}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000"
                        style={{ width: `${Math.min(100, (active / d.mg) * 100)}%`, background: DOSE_COLORS[i % DOSE_COLORS.length] }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-zinc-600 w-10 text-right">{Math.round(active)}mg</span>
                  </div>
                )
              })}
            </div>

            {/* Warning banner */}
            {currentHour > lastCoffeeHour && (
              <div className="mt-4 rounded-xl border border-orange-500/25 bg-orange-500/[0.07] px-4 py-3">
                <p className="text-[11px] font-mono text-orange-400">
                  △ Past last coffee window ({formatHour(lastCoffeeHour)}) — a dose now may affect sleep
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Log Dose ── (Change 2: no number prefix) */}
        <div className="cosmic-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Log Dose</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-[9px] font-mono text-zinc-600">{Math.round(totalMg)}mg total</span>
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {CAFFEINE_PRESETS.map(preset => (
              <button
                key={preset.source}
                onClick={() => logCaffeine.mutate({ source: preset.source, amount_mg: preset.amount_mg })}
                disabled={logCaffeine.isPending}
                className="rounded-full bg-white/[0.06] border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-white active:bg-white/10 disabled:opacity-50 transition-colors"
              >
                {preset.source} <span className="text-zinc-400">{preset.amount_mg}mg</span>
              </button>
            ))}
          </div>
          {(caffeineLogs?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {[...(caffeineLogs ?? [])].reverse().map(log => (
                <div key={log.id} className="flex items-center gap-3">
                  <span className="w-16 text-xs font-mono text-zinc-500">{formatTime(log.logged_at)}</span>
                  <span className="flex-1 text-xs text-zinc-300">{log.source}</span>
                  <span className="text-xs text-zinc-500">{log.amount_mg}mg</span>
                  <button onClick={() => deleteCaffeine.mutate(log.id)} className="px-1 text-sm text-zinc-600 active:text-zinc-400">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] font-mono text-zinc-700">No doses logged today</p>
          )}
        </div>

        {/* ── Change 9: Dose Stack (Per-Dose Contribution) ── */}
        {doses.length > 0 && (
          <div className="cosmic-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-mono text-zinc-500 tracking-[0.2em] uppercase">Per-Dose Contribution</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 mb-3">
              {doses.map((d, i) => (
                <div key={d.id} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ background: DOSE_COLORS[i % DOSE_COLORS.length] }} />
                  <span className="text-[10px] font-mono text-zinc-400">
                    {formatHourShort(d.hour)} · {d.mg}mg {d.source}
                  </span>
                </div>
              ))}
            </div>

            {/* Chart */}
            <div className="relative">
              <svg viewBox={`0 0 ${SVG_W} ${STACK_SVG_H}`} preserveAspectRatio="none" className="w-full" style={{ height: 100, display: 'block' }}>
                <defs>
                  {doseStackPaths.map((dp, i) => (
                    <linearGradient key={i} id={`stackGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={dp.color} stopOpacity="0.25" />
                      <stop offset="100%" stopColor={dp.color} stopOpacity="0.02" />
                    </linearGradient>
                  ))}
                </defs>
                {/* Now line */}
                <line x1={nowX} x2={nowX} y1="0" y2={STACK_SVG_H} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="2,4" />
                {doseStackPaths.map((dp, i) => (
                  <g key={i}>
                    <path d={dp.areaPath} fill={`url(#stackGrad${i})`} />
                    <polyline points={dp.linePts} fill="none" stroke={dp.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                  </g>
                ))}
              </svg>
              <div className="flex justify-between mt-1 px-0.5">
                {timeLabelHours.map(h => (
                  <span key={h} className="text-[9px] font-mono text-zinc-700">{formatHour(h)}</span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

    </main>
  )
}
