'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'

const EASE_OUT = [0.16, 1, 0.3, 1] as const
import { useQueryClient } from '@tanstack/react-query'
import { useGymConfig, useGymExercises, useAllGymLogs, useBodyWeights, useBodyMeasurements, useProgressPhotos } from '@/features/gym/queries'
import { useHealthProfile } from '@/features/health/queries'
import {
  useSaveGymConfig,
  useCreateExercise, useUpdateExercise, useDeleteExercise, useReorderExercises,
  useLogSet, useDeleteLog,
  useLogBodyWeight, useLogBodyMeasurement, useUploadPhoto, useDeletePhoto,
} from '@/features/gym/mutations'
import type { GymConfig, GymExercise, GymLog, BodyWeight, Prescription, ProgressPhoto } from '@/features/gym/types'
import ProtocolCard from './ProtocolCard'
import SetTimerRing, { fmtClock, type TimerPhase } from './SetTimerRing'

type SetTimerState = { phase: TimerPhase; phaseStart: number | null; sessionStart: number | null }
const SET_TIMER_KEY = 'atlas.gym.timer'
const GYM_LAST_KEY = 'atlas.gym.last' // last exercise + weight + reps, restored on app open

// ─── helpers ────────────────────────────────────────────────────────────────

function toPSTDate(): Date {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
}

function todayKey(): string {
  const d = toPSTDate()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function todayDateLabel(): string {
  const d = toPSTDate()
  return DOWS[d.getDay()] + ', ' + MONS[d.getMonth()] + ' ' + d.getDate()
}

function logDatePST(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// US Navy body fat formula — circumferences in inches
function navyBfPct(heightCm: number, sex: 'm' | 'f' | 'o', neckIn: number, waistIn: number, hipIn?: number | null): number | null {
  const heightIn = heightCm / 2.54
  let bf: number
  if (sex === 'f') {
    if (!hipIn || waistIn + hipIn - neckIn <= 0) return null
    bf = 163.205 * Math.log10(waistIn + hipIn - neckIn) - 97.684 * Math.log10(heightIn) - 78.387
  } else {
    if (waistIn - neckIn <= 0) return null
    bf = 86.010 * Math.log10(waistIn - neckIn) - 70.041 * Math.log10(heightIn) + 36.76
  }
  return Math.max(2, Math.min(60, bf))
}

function computeSplit(config: GymConfig): { name: string; index: number } {
  const rot = config.split_rotation
  if (!rot.length) return { name: '—', index: 0 }
  if (!config.split_anchor) return { name: rot[0], index: 0 }
  try {
    const a = new Date(config.split_anchor.date + 'T12:00:00')
    const t = new Date()
    a.setHours(12, 0, 0, 0)
    t.setHours(12, 0, 0, 0)
    const diffDays = Math.round((t.getTime() - a.getTime()) / 86400000)
    const idx = ((config.split_anchor.index + diffDays) % rot.length + rot.length) % rot.length
    return { name: rot[idx], index: idx }
  } catch {
    return { name: rot[0], index: 0 }
  }
}

function isRest(name: string): boolean {
  return /^rest\b/i.test(name ?? '')
}

function splitLabel(name: string): string {
  if (!name) return '—'
  return (isRest(name) ? 'REST DAY' : name.toUpperCase() + ' DAY')
}

function compute1RM(weight: number, reps: number): number {
  return weight * (1 + reps / 30)
}

function getRx(logs: GymLog[], ex: GymExercise, upgradeAtReps: number, units: string): Prescription | null {
  if (!logs.length) return null
  const last = logs[logs.length - 1]
  const { reps, weight } = last
  const { rep_min: repMin, rep_max: repMax, step, bodyweight: bw } = ex
  const upgradeAt = Math.min(upgradeAtReps, repMax)

  // Stuck: consecutive sets at same weight with reps below repMin
  let stuck = 0
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].weight === weight) stuck++
    else break
  }

  if (bw) {
    if (reps >= upgradeAt) return { action: 'INCREASE', reason: `${reps} reps — strong. Push for ${reps + 1} next time.` }
    if (reps >= repMin) return { action: 'HOLD', reason: `${reps} reps. Push for ${reps + 1} next session.` }
    return { action: 'REPEAT', reason: `${reps} reps fell short. Repeat until you hit ${repMin}+.` }
  }

  if (stuck >= 3 && reps < repMin) {
    return {
      action: 'DELOAD',
      reason: `Stuck at ${weight}${units} for ${stuck} sets. Drop 10%, reset, build back.`,
      nextWeight: Math.round((weight * 0.9) / step) * step,
    }
  }
  if (reps >= upgradeAt) return {
    action: 'INCREASE',
    reason: `You hit ${reps} reps — time to add ${step}${units}. Expect ${repMin}–${repMin + 1} next session.`,
  }
  if (reps >= repMin) return {
    action: 'HOLD',
    reason: `${reps} reps in target. Stay at ${weight}${units}, push for ${reps + 1}.`,
  }
  const dropWeight = Math.max(0, Math.round((weight - step) / step) * step)
  if (dropWeight < weight) {
    return {
      action: 'DROP',
      reason: `${reps} reps short of ${repMin}. Drop to ${dropWeight}${units} next session.`,
      nextWeight: dropWeight,
    }
  }
  return {
    action: 'REPEAT',
    reason: `${reps} reps short of ${repMin}–${upgradeAt}. Repeat ${weight}${units} until you hit ${repMin}+ clean.`,
  }
}

// SVG sparkline — each point is one logged set (last 15), full-bleed, no dots
function PoSparkline({ logs, bodyweight }: { logs: GymLog[]; bodyweight: boolean }) {
  const pts10 = logs.slice(-15)

  if (pts10.length < 2) return (
    <div className="flex items-center justify-center h-[105px] text-xs text-white/30">
      Need 2+ sets for trend
    </div>
  )

  const W = 400, H = 105
  const vals = pts10.map(l => bodyweight ? l.reps : l.weight)
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const range = maxV - minV || 1

  const points = pts10.map((_, i) => ({
    x: (i / (pts10.length - 1)) * W,
    y: H - 6 - ((vals[i] - minV) / range) * (H - 18),
  }))

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i++) {
    const cx = (points[i - 1].x + points[i].x) / 2
    d += ` C ${cx.toFixed(1)} ${points[i-1].y.toFixed(1)}, ${cx.toFixed(1)} ${points[i].y.toFixed(1)}, ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}`
  }
  const fill = d + ` L ${points[points.length-1].x} ${H} L ${points[0].x} ${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 105 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spk-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spk-fill)" />
      <path d={d} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Body weight area chart
function WtChart({ entries, units }: { entries: BodyWeight[]; units: string }) {
  const W = 320, H = 100
  if (entries.length < 2) return null

  const weights = entries.map(e => e.weight)
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const range = maxW - minW || 1
  const padded = { min: minW - range * 0.1, max: maxW + range * 0.1 }
  const totalRange = padded.max - padded.min

  const inset = 5
  const pts = entries.map((e, i) => ({
    x: inset + (i / (entries.length - 1)) * (W - 2 * inset),
    y: H - 10 - ((e.weight - padded.min) / totalRange) * (H - 20),
  }))

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i-1].x + pts[i].x) / 2
    d += ` C ${cx.toFixed(1)} ${pts[i-1].y.toFixed(1)}, ${cx.toFixed(1)} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
  }
  const fill = d + ` L ${pts[pts.length-1].x} ${H} L ${pts[0].x} ${H} Z`

  // Rolling 7-day average line (follows the data, not flat)
  const showAvg = entries.length >= 7
  const avgPts = showAvg ? entries.map((_, i) => {
    const slice = entries.slice(Math.max(0, i - 6), i + 1)
    const avg = slice.reduce((s, e) => s + e.weight, 0) / slice.length
    return {
      x: pts[i].x,
      y: H - 10 - ((avg - padded.min) / totalRange) * (H - 20),
    }
  }) : []

  let avgPath = ''
  if (avgPts.length >= 2) {
    avgPath = `M ${avgPts[0].x.toFixed(1)} ${avgPts[0].y.toFixed(1)}`
    for (let i = 1; i < avgPts.length; i++) {
      const cx = (avgPts[i-1].x + avgPts[i].x) / 2
      avgPath += ` C ${cx.toFixed(1)} ${avgPts[i-1].y.toFixed(1)}, ${cx.toFixed(1)} ${avgPts[i].y.toFixed(1)}, ${avgPts[i].x.toFixed(1)} ${avgPts[i].y.toFixed(1)}`
    }
  }

  const lastPt = pts[pts.length - 1]

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="wt-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 50, 80].map(y => (
          <line key={y} x1="0" y1={y} x2={W} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}
        <path d={fill} fill="url(#wt-fill)" />
        <path d={d} fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" />
        {avgPath && (
          <path d={avgPath} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55" />
        )}
        <circle cx={lastPt.x} cy={lastPt.y} r="4" fill="#4ade80" />
      </svg>
      {showAvg && (
        <div className="flex items-center gap-4 px-1 mt-1">
          <div className="flex items-center gap-1.5">
            <svg width="16" height="4" viewBox="0 0 16 4"><line x1="0" y1="2" x2="16" y2="2" stroke="#4ade80" strokeWidth="2" /></svg>
            <span className="text-[9px] text-white/25 tracking-widest uppercase">Daily</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="16" height="4" viewBox="0 0 16 4"><line x1="0" y1="2" x2="16" y2="2" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.55" /></svg>
            <span className="text-[9px] text-white/25 tracking-widest uppercase">7-Day Avg</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── sub-components ──────────────────────────────────────────────────────────

interface ExModalState {
  open: boolean
  mode: 'add' | 'edit'
  id?: string
  name: string
  gymId: string
  dayIds: string[]
  bodyweight: boolean
  repMin: number
  repMax: number
  step: number
}

const EMPTY_EX_MODAL: ExModalState = {
  open: false, mode: 'add', name: '', gymId: 'g_default', dayIds: [],
  bodyweight: false, repMin: 8, repMax: 12, step: 2.5,
}

// ─── main ────────────────────────────────────────────────────────────────────

interface Props {
  today: string
  initialConfig: GymConfig
  initialExercises: GymExercise[]
  initialBodyWeights: BodyWeight[]
}

// Scrollable exercise chip: tap selects; press & hold (no movement) opens the
// reorder panel. A swipe still scrolls the row (no drag captured here).
function ScrollChip({ ex, isActive, onSelect, onLongPress }: {
  ex: GymExercise
  isActive: boolean
  onSelect: (id: string) => void
  onLongPress: () => void
}) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef({ x: 0, y: 0 })
  const fired = useRef(false)
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined } }

  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onPointerDown={(e) => {
        fired.current = false
        start.current = { x: e.clientX, y: e.clientY }
        timer.current = window.setTimeout(() => { fired.current = true; onLongPress() }, 450)
      }}
      onPointerMove={(e) => {
        if (timer.current && (Math.abs(e.clientX - start.current.x) > 8 || Math.abs(e.clientY - start.current.y) > 8)) clear()
      }}
      onPointerUp={clear}
      onPointerCancel={clear}
      onClick={() => { if (!fired.current) onSelect(ex.id) }}
      className="relative px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap flex-shrink-0 transition-all duration-200"
      style={isActive ? {
        background: 'rgba(74,222,128,0.1)',
        border: '1px solid rgba(74,222,128,0.35)',
        color: '#4ade80',
        boxShadow: '0 0 16px rgba(74,222,128,0.14), inset 0 0 10px rgba(74,222,128,0.05)',
      } : {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        color: 'rgba(255,255,255,0.45)',
      }}
    >
      {ex.name}
      {isActive && (
        <motion.span
          layoutId="ex-active-dot"
          className="absolute -bottom-px left-1/2 -translate-x-1/2 w-6 h-px rounded-full"
          style={{ background: 'rgba(74,222,128,0.7)' }}
        />
      )}
    </motion.button>
  )
}

// One row in the reorder panel — vertical drag via the ⠿ handle (touch-action
// none on the handle so it never fights the panel's scroll).
function ReorderRow({ ex }: { ex: GymExercise }) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={ex}
      as="div"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.03, backgroundColor: 'rgba(74,222,128,0.08)' }}
      className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] select-none"
    >
      <span className="flex-1 text-sm font-semibold text-white/85 truncate">{ex.name}</span>
      <span
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab text-white/30 text-lg leading-none px-2 -mr-1"
        style={{ touchAction: 'none' }}
        aria-label="Drag to reorder"
      >⠿</span>
    </Reorder.Item>
  )
}

// Bottom-sheet reorder panel: a vertical drag list, no horizontal-scroll
// conflict. Reliable on touch + desktop.
function ReorderSheet({ items, onClose, onSave }: {
  items: GymExercise[]
  onClose: () => void
  onSave: (orderedIds: string[]) => void
}) {
  const [order, setOrder] = useState(items)
  const done = () => { onSave(order.map(e => e.id)); onClose() }
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      onClick={done}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-4 max-h-[80vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-white">Reorder exercises</h3>
            <p className="text-[11px] text-white/35 mt-0.5">Drag the ⠿ handle</p>
          </div>
          <button onClick={done} className="text-sm font-semibold text-green-400 active:opacity-60 px-2 py-1">Done</button>
        </div>
        <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="space-y-2">
          {order.map(ex => <ReorderRow key={ex.id} ex={ex} />)}
        </Reorder.Group>
      </div>
    </div>,
    document.body,
  )
}

export default function GymClient({ today, initialConfig, initialExercises, initialBodyWeights }: Props) {
  const qc = useQueryClient()

  // seed initial data
  if (!qc.getQueryData(['gym-config'])) qc.setQueryData(['gym-config'], initialConfig)
  if (!qc.getQueryData(['gym-exercises'])) qc.setQueryData(['gym-exercises'], initialExercises)
  if (!qc.getQueryData(['body-weights'])) qc.setQueryData(['body-weights'], initialBodyWeights)

  const { data: config = initialConfig } = useGymConfig()
  const { data: exercises = [] } = useGymExercises()
  const { data: allLogs = [] } = useAllGymLogs()
  const { data: bodyWeights = [] } = useBodyWeights()
  const { data: bodyMeasurements = [] } = useBodyMeasurements()
  const { data: photos = [] } = useProgressPhotos()
  const { data: healthProfile } = useHealthProfile()

  const saveConfig = useSaveGymConfig()
  const createEx = useCreateExercise()
  const updateEx = useUpdateExercise()
  const deleteEx = useDeleteExercise()
  const logSet = useLogSet()
  const deleteLog = useDeleteLog()
  const logBw = useLogBodyWeight()
  const logMeasurement = useLogBodyMeasurement()
  const uploadPhoto = useUploadPhoto()
  const deletePhotoMut = useDeletePhoto()

  // Today's Call condensed badge
  const [todaysCall, setTodaysCall] = useState<{ color: 'GREEN' | 'YELLOW' | 'RED'; headline: string } | null>(null)
  const callFetched = useRef(false)
  useEffect(() => {
    if (callFetched.current) return
    callFetched.current = true
    fetch('/api/home/todays-call', { method: 'POST' })
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (j && !j.noData) setTodaysCall({ color: j.color, headline: j.headline }) })
      .catch(() => {})
  }, [])

  // Filter state
  const [filterGym, setFilterGym] = useState<string>(config.gyms[0]?.id ?? 'g_default')
  const [filterDay, setFilterDay] = useState<string>(() => {
    const split = computeSplit(config)
    const rot = config.split_rotation
    // On rest days, advance to the next non-rest day in the rotation
    let effectiveName = split.name
    if (isRest(effectiveName) && rot.length > 0) {
      for (let i = 1; i < rot.length; i++) {
        const candidate = rot[(split.index + i) % rot.length]
        if (!isRest(candidate)) { effectiveName = candidate; break }
      }
    }
    const match = config.days.find(d => d.name.toLowerCase() === effectiveName.toLowerCase())
    return match?.id ?? config.days[0]?.id ?? ''
  })
  const autoAdvancedRef = useRef(false)

  // After data loads, override calendar-based day selection with last-workout-based advancement
  useEffect(() => {
    if (autoAdvancedRef.current) return
    if (allLogs.length === 0 || exercises.length === 0) return

    autoAdvancedRef.current = true

    if (config.split_rotation.length === 0 || config.days.length === 0) return

    // If today already has logs, snap to that day
    const todayLogs = allLogs.filter(l => logDatePST(l.logged_at) === today)
    if (todayLogs.length > 0) {
      const ex = exercises.find(e => e.id === todayLogs[0].exercise_id)
      const exDayId = ex?.day_ids?.find(id => config.days.find(d => d.id === id))
      if (exDayId) {
        setFilterDay(exDayId)
      }
      return
    }

    // Advance from the last logged day
    const mostRecent = allLogs.reduce((a, b) => a.logged_at > b.logged_at ? a : b)
    const lastEx = exercises.find(e => e.id === mostRecent.exercise_id)
    if (!lastEx) return

    const lastDay = config.days.find(d => lastEx.day_ids?.includes(d.id))
    if (!lastDay) return

    const rot = config.split_rotation
    const lastIdx = rot.findIndex(name => name.toLowerCase() === lastDay.name.toLowerCase())
    if (lastIdx === -1) return

    let nextIdx = (lastIdx + 1) % rot.length
    for (let i = 0; i < rot.length; i++) {
      if (!isRest(rot[nextIdx])) break
      nextIdx = (nextIdx + 1) % rot.length
    }

    const nextDay = config.days.find(d => d.name.toLowerCase() === rot[nextIdx].toLowerCase())
    if (nextDay) setFilterDay(nextDay.id)
  }, [allLogs, exercises, config, today])

  const [currentExId, setCurrentExId] = useState<string | null>(null)

  // Weight stepper
  const [weightInput, setWeightInput] = useState<string>('0')
  const [selectedReps, setSelectedReps] = useState<number>(8)

  // Restore the last exercise / weight / reps across app restarts (localStorage).
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || exercises.length === 0) return
    restoredRef.current = true
    let saved: { exId?: string; weight?: string; reps?: number } | null = null
    try { saved = JSON.parse(localStorage.getItem(GYM_LAST_KEY) || 'null') } catch {}
    if (!saved?.exId) return
    const ex = exercises.find(e => e.id === saved!.exId)
    if (!ex) return
    autoAdvancedRef.current = true // last-exercise restore wins over split auto-advance
    if (ex.gym_id && ex.gym_id !== 'both') setFilterGym(ex.gym_id)
    const dayId = ex.day_ids?.find(id => config.days.some(d => d.id === id))
    setFilterDay(dayId ?? '')
    setCurrentExId(ex.id)
    if (typeof saved.weight === 'string') setWeightInput(saved.weight)
    if (typeof saved.reps === 'number') setSelectedReps(saved.reps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises])

  // Modals
  const [exModal, setExModal] = useState<ExModalState>(EMPTY_EX_MODAL)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const [showSettings, setShowSettings] = useState(false)
  const [showRotation, setShowRotation] = useState(false)
  const [rotDraft, setRotDraft] = useState<string[]>([])
  const [rotTodayIdx, setRotTodayIdx] = useState(0)

  // Body weight input
  const [bwInput, setBwInput] = useState<string>('')
  const [showMeasureModal, setShowMeasureModal] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [neckIn, setNeckIn] = useState('')
  const [waistIn, setWaistIn] = useState('')
  const [hipIn, setHipIn] = useState('')
  function openMeasureModal() {
    const last = bodyMeasurements[bodyMeasurements.length - 1]
    if (last) {
      setNeckIn(String(last.neck_in))
      setWaistIn(String(last.waist_in))
      if (last.hip_in != null) setHipIn(String(last.hip_in))
    }
    setShowMeasureModal(true)
  }
  const todayBw = bodyWeights.find(w => w.date_key === today)

  // Today done + history collapse — persisted to localStorage keyed by date
  const DONE_KEY = `gym_done_${today}`
  const [todayDone, setTodayDoneState] = useState(() => {
    try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
  })
  function setTodayDone(fn: boolean | ((prev: boolean) => boolean)) {
    setTodayDoneState(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      try { next ? localStorage.setItem(DONE_KEY, '1') : localStorage.removeItem(DONE_KEY) } catch {}
      return next
    })
  }
  const [todayExpanded, setTodayExpanded] = useState(true)
  const [pastExpanded, setPastExpanded] = useState(false)
  const [whoopWorkoutStrain, setWhoopWorkoutStrain] = useState<number | null>(null)
  const whoopStrainFetched = useRef(false)

  // Coach (devil / angel)
  const [coachText, setCoachText] = useState('')
  const [coachStreaming, setCoachStreaming] = useState(false)
  const [coachMode, setCoachMode] = useState<'devil' | 'angel' | null>(null)
  const [logSetFlash, setLogSetFlash] = useState(false)

  // ── set timer (active / rest stopwatch, client-only, survives remount) ─────
  const [timer, setTimer] = useState<SetTimerState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SET_TIMER_KEY) || 'null')
      // only restore a recent session (< 6h) so a stale next-day timer resets
      if (saved?.phase && saved.phase !== 'idle' && saved.phaseStart && Date.now() - saved.phaseStart < 6 * 3600_000) {
        return saved as SetTimerState
      }
    } catch {}
    return { phase: 'idle', phaseStart: null, sessionStart: null }
  })
  const [nowTs, setNowTs] = useState(() => Date.now())

  useEffect(() => {
    try {
      if (timer.phase === 'idle') localStorage.removeItem(SET_TIMER_KEY)
      else localStorage.setItem(SET_TIMER_KEY, JSON.stringify(timer))
    } catch {}
  }, [timer])

  useEffect(() => {
    if (timer.phase === 'idle') return
    const id = setInterval(() => setNowTs(Date.now()), 250)
    return () => clearInterval(id)
  }, [timer.phase])

  const phaseMs = timer.phaseStart ? nowTs - timer.phaseStart : 0
  const sessionMs = timer.sessionStart ? nowTs - timer.sessionStart : 0

  function handleSetButton() {
    const t = Date.now()
    setNowTs(t)
    if (timer.phase === 'active') {
      handleLogSet()
      setTimer(s => ({ ...s, phase: 'rest', phaseStart: t }))
    } else {
      setTimer(s => ({ phase: 'active', phaseStart: t, sessionStart: s.sessionStart ?? t }))
    }
  }
  function endSession() {
    setTimer({ phase: 'idle', phaseStart: null, sessionStart: null })
  }

  async function streamCoach(mode: 'devil' | 'angel') {
    setCoachMode(mode)
    setCoachStreaming(true)
    setCoachText('')
    try {
      const res = await fetch('/api/gym/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok || !res.body) {
        const errBody = await res.text().catch(() => '')
        setCoachText(`Error ${res.status}${errBody ? ': ' + errBody.slice(0, 120) : ''}. Try again.`)
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

  // Progress photos overlay
  const [showPhotos, setShowPhotos] = useState(false)
  const [viewPhoto, setViewPhoto] = useState<ProgressPhoto | null>(null)
  const [compareIdx, setCompareIdx] = useState<[number, number]>([0, 1])
  const [photoMode, setPhotoMode] = useState<'grid' | 'compare'>('grid')
  const photoInputRef = useRef<HTMLInputElement>(null)
  const libraryInputRef = useRef<HTMLInputElement>(null)

  // Settings local state
  const [settingsGyms, setSettingsGyms] = useState(config.gyms)
  const [settingsUnits, setSettingsUnits] = useState(config.units)
  const [settingsUpgradeAt, setSettingsUpgradeAt] = useState(config.upgrade_at_reps)
  const [coachRepRec, setCoachRepRec] = useState<{ reps: number; reason: string } | null>(null)
  const [coachRepLoading, setCoachRepLoading] = useState(false)
  const [coachStepRec, setCoachStepRec] = useState<{ step: number; reason: string } | null>(null)
  const [coachStepLoading, setCoachStepLoading] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  // ── derived ──────────────────────────────────────────────────────────────

  const split = useMemo(() => computeSplit(config), [config])

  const filteredExercises = useMemo(() => exercises.filter(ex => {
    const gymOk = ex.gym_id === 'both' || ex.gym_id === filterGym
    const dayOk = !filterDay || (ex.day_ids ?? []).includes(filterDay)
    return gymOk && dayOk
  }), [exercises, filterGym, filterDay])

  const currentEx = useMemo(() =>
    filteredExercises.find(e => e.id === currentExId) ?? filteredExercises[0] ?? null,
    [filteredExercises, currentExId]
  )

  // Persist current exercise + weight + reps so the page resumes where you left off.
  useEffect(() => {
    if (!restoredRef.current || !currentEx?.id) return
    try {
      localStorage.setItem(GYM_LAST_KEY, JSON.stringify({ exId: currentEx.id, weight: weightInput, reps: selectedReps }))
    } catch {}
  }, [currentEx, weightInput, selectedReps])

  // Reorder panel (vertical drag list). Saves the new order back to order_index.
  const reorderEx = useReorderExercises()
  const [reorderOpen, setReorderOpen] = useState(false)

  function saveExerciseOrder(newIds: string[]) {
    const oldIds = filteredExercises.map(e => e.id)
    const unchanged = newIds.length === oldIds.length && newIds.every((id, i) => id === oldIds[i])
    if (unchanged) return
    // Merge the reordered (filtered) list back into the full global order so
    // order_index stays sensible for exercises hidden by the current filter.
    const filteredSet = new Set(oldIds)
    const fullSorted = [...exercises].sort((a, b) => a.order_index - b.order_index)
    let vi = 0
    const newFullIds = fullSorted.map(e => filteredSet.has(e.id) ? newIds[vi++] : e.id)
    reorderEx.mutate(newFullIds)
  }

  const exLogs = useMemo(() =>
    allLogs.filter(l => l.exercise_id === currentEx?.id).sort((a, b) => a.logged_at.localeCompare(b.logged_at)),
    [allLogs, currentEx]
  )

  const repMin = currentEx?.rep_min ?? 6
  const repMax = currentEx?.rep_max ?? 8

  const rx = useMemo(() => {
    if (!currentEx) return null
    return getRx(exLogs, currentEx, config.upgrade_at_reps, config.units)
  }, [exLogs, currentEx, config.upgrade_at_reps, config.units])

  const bestSet = useMemo(() => {
    if (!exLogs.length) return null
    if (currentEx?.bodyweight) return exLogs.reduce((b, l) => l.reps > b.reps ? l : b)
    return exLogs.reduce((b, l) => compute1RM(l.weight, l.reps) > compute1RM(b.weight, b.reps) ? l : b)
  }, [exLogs, currentEx])

  // Last set info (for banner)
  const lastLog = exLogs[exLogs.length - 1] ?? null
  const lastLogDaysAgo = lastLog
    ? Math.floor((Date.now() - new Date(lastLog.logged_at).getTime()) / 86400000)
    : null
  const lastLogAgo = lastLogDaysAgo === 0 ? 'today' : lastLogDaysAgo === 1 ? 'yesterday' : `${lastLogDaysAgo}d ago`

  // ── actions ──────────────────────────────────────────────────────────────

  function selectEx(id: string) {
    const ex = exercises.find(e => e.id === id)
    if (!ex) return
    setCurrentExId(id)
    const logs = allLogs.filter(l => l.exercise_id === id).sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const lastLog = logs[logs.length - 1]
    setWeightInput(String(lastLog?.weight ?? 0))
    setSelectedReps(ex.rep_max)
  }

  function handleLogSet() {
    if (!currentEx) return
    const reps = selectedReps
    const w = currentEx.bodyweight ? 0 : (parseFloat(weightInput) || 0)
    logSet.mutate({ exercise_id: currentEx.id, weight: w, reps }, {
      onSuccess: () => {
        setLogSetFlash(true)
        setTimeout(() => setLogSetFlash(false), 400)
      },
    })
  }

  function openAddEx() {
    setCoachStepRec(null)
    setExModal({
      ...EMPTY_EX_MODAL,
      open: true, mode: 'add',
      gymId: filterGym,
      dayIds: filterDay ? [filterDay] : [],
    })
  }

  function openEditEx() {
    if (!currentEx) return
    setCoachStepRec(null)
    setExModal({
      open: true, mode: 'edit',
      id: currentEx.id,
      name: currentEx.name,
      gymId: currentEx.gym_id,
      dayIds: currentEx.day_ids ?? [],
      bodyweight: currentEx.bodyweight,
      repMin: currentEx.rep_min,
      repMax: currentEx.rep_max,
      step: currentEx.step,
    })
  }

  function saveEx() {
    const { mode, id, name, gymId, dayIds, bodyweight, repMin, repMax, step } = exModal
    if (!name.trim() || !gymId || !dayIds.length) return
    if (mode === 'edit' && id) {
      updateEx.mutate({ id, name: name.trim(), gym_id: gymId, day_ids: dayIds, bodyweight, start_weight: 0, rep_min: repMin, rep_max: repMax, step })
    } else {
      createEx.mutate(
        { name: name.trim(), gym_id: gymId, day_ids: dayIds, bodyweight, start_weight: 0, rep_min: repMin, rep_max: repMax, step, order_index: exercises.length },
        { onSuccess: (ex) => { setCurrentExId(ex.id); setWeightInput('0') } }
      )
    }
    setExModal(EMPTY_EX_MODAL)
  }

  function confirmDeleteEx() {
    if (!currentEx) return
    if (!confirm(`Delete "${currentEx.name}" and all its logs?`)) return
    deleteEx.mutate(currentEx.id)
    setCurrentExId(null)
    setExModal(EMPTY_EX_MODAL)
  }

  function openRotModal() {
    setRotDraft(config.split_rotation.slice())
    setRotTodayIdx(split.index < config.split_rotation.length ? split.index : 0)
    setShowRotation(true)
  }

  function saveRotation() {
    const cleaned = rotDraft.map(s => s.trim()).filter(Boolean)
    if (!cleaned.length) return
    const newTodayIdx = rotTodayIdx >= cleaned.length ? 0 : rotTodayIdx

    // Sync config.days from non-rest entries in the rotation
    const existingById = new Map(config.days.map(d => [d.name.toLowerCase(), d.id]))
    const nonRestNames = cleaned.filter(n => !isRest(n))
    // dedupe while preserving order
    const seen = new Set<string>()
    const newDays = nonRestNames
      .filter(name => { const k = name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
      .map(name => ({ id: existingById.get(name.toLowerCase()) ?? ('d_' + Date.now() + '_' + Math.random().toString(36).slice(2)), name }))

    saveConfig.mutate({
      ...config,
      days: newDays,
      split_rotation: cleaned,
      split_anchor: { date: today, index: newTodayIdx },
    })
    setShowRotation(false)
  }

  function saveSettings() {
    saveConfig.mutate({
      ...config,
      gyms: settingsGyms,
      units: settingsUnits,
      upgrade_at_reps: settingsUpgradeAt,
    })
    setShowSettings(false)
  }

  function openSettings() {
    setSettingsGyms(config.gyms.map(g => ({ ...g })))
    setSettingsUnits(config.units)
    setSettingsUpgradeAt(config.upgrade_at_reps)
    setCoachRepRec(null)
    setShowSettings(true)
  }

  async function fetchCoachStep(exerciseName: string, isBodyweight: boolean) {
    setCoachStepRec(null)
    setCoachStepLoading(true)
    try {
      const res = await fetch('/api/gym/coach-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseName, isBodyweight, units: config.units }),
      })
      const json = await res.json()
      setCoachStepRec(json)
      setExModal(m => ({ ...m, step: json.step }))
    } catch {
      setCoachStepRec({ step: 2.5, reason: 'Could not reach coach — using default.' })
    } finally {
      setCoachStepLoading(false)
    }
  }

  async function fetchCoachReps() {
    setCoachRepRec(null)
    setCoachRepLoading(true)
    try {
      const res = await fetch('/api/gym/coach-reps', { method: 'POST' })
      const json = await res.json()
      setCoachRepRec(json)
      setSettingsUpgradeAt(json.reps)
    } catch {
      setCoachRepRec({ reps: 12, reason: 'Could not reach coach — using default.' })
      setSettingsUpgradeAt(12)
    } finally {
      setCoachRepLoading(false)
    }
  }

  async function handleExport() {
    const res = await fetch('/api/gym/export')
    const json = await res.json()
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atlas-gym-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const json = JSON.parse(text)
    await fetch('/api/gym/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    })
    qc.invalidateQueries({ queryKey: ['gym-config'] })
    qc.invalidateQueries({ queryKey: ['gym-exercises'] })
    qc.invalidateQueries({ queryKey: ['po-logs'] })
    setShowSettings(false)
  }

  async function handleReset() {
    if (!window.confirm('Delete all gym data? This cannot be undone.')) return
    await fetch('/api/gym/reset', { method: 'DELETE' })
    qc.invalidateQueries({ queryKey: ['gym-config'] })
    qc.invalidateQueries({ queryKey: ['gym-exercises'] })
    qc.invalidateQueries({ queryKey: ['po-logs'] })
    setShowSettings(false)
  }

  function handlePhotoFile(file: File) {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('date', today)
    const todayBwEntry = bodyWeights.find(w => w.date_key === today)
    if (todayBwEntry) {
      fd.append('weight', String(todayBwEntry.weight))
      fd.append('weight_unit', config.units)
    }
    uploadPhoto.mutate(fd)
  }

  // ── render ────────────────────────────────────────────────────────────────

  const rxColors: Record<string, string> = {
    INCREASE: 'text-green-400 border-green-400/30 bg-green-400/10',
    HOLD: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    REPEAT: 'text-white/60 border-white/10 bg-white/5',
    DROP: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
    DELOAD: 'text-red-400 border-red-400/30 bg-red-400/10',
  }
  const rxIcons: Record<string, string> = {
    INCREASE: '↑', HOLD: '→', REPEAT: '↺', DROP: '↓', DELOAD: '⬇',
  }

  const bwDelta = bodyWeights.length >= 2
    ? bodyWeights[bodyWeights.length - 1].weight - bodyWeights[0].weight
    : null

  // Green if moving toward goal: losing = negative delta good, gaining = positive delta good
  const targetWeight = healthProfile?.target_weight_lbs ?? null
  const currentWeight = bodyWeights.length ? bodyWeights[bodyWeights.length - 1].weight : null

  // Body composition estimate — trend always available; BF% needs height/age/sex in profile
  const compEstimate = (() => {
    if (!currentWeight || bodyWeights.length < 4) return null
    const recent = bodyWeights.slice(-Math.min(bodyWeights.length, 30))
    const daySpan = Math.max(1, (new Date(recent[recent.length - 1].date_key).getTime() - new Date(recent[0].date_key).getTime()) / 86400000)
    const weeklyRate = ((recent[recent.length - 1].weight - recent[0].weight) / daySpan) * 7

    // Strength trend over the same window — proxy for whether weight change is fat or muscle.
    // Compares best e1RM per exercise in the first vs second half of the window.
    const windowStart = new Date(recent[0].date_key).getTime()
    const midpoint = windowStart + (Date.now() - windowStart) / 2
    const e1rm = (l: GymLog) => l.weight * (1 + l.reps / 30)
    const bestByExercise = (logs: GymLog[]) => {
      const best = new Map<string, number>()
      for (const l of logs) best.set(l.exercise_id, Math.max(best.get(l.exercise_id) ?? 0, e1rm(l)))
      return best
    }
    const windowLogs = allLogs.filter(l => new Date(l.logged_at).getTime() >= windowStart)
    const firstHalf = bestByExercise(windowLogs.filter(l => new Date(l.logged_at).getTime() < midpoint))
    const secondHalf = bestByExercise(windowLogs.filter(l => new Date(l.logged_at).getTime() >= midpoint))
    const commonChanges = [...firstHalf.entries()]
      .filter(([id, v]) => v > 0 && secondHalf.has(id))
      .map(([id, v]) => (secondHalf.get(id)! - v) / v)
    const strengthTrend = commonChanges.length >= 2
      ? commonChanges.reduce((s, v) => s + v, 0) / commonChanges.length
      : null

    const strUp = strengthTrend != null && strengthTrend > 0.02
    const strDown = strengthTrend != null && strengthTrend < -0.02
    let verdict: string
    if (Math.abs(weeklyRate) < 0.25) {
      verdict = strUp ? 'Recomp — gaining muscle' : strDown ? 'Maintaining — strength dipping' : 'Maintaining weight'
    } else if (weeklyRate < 0) {
      verdict = strengthTrend == null ? 'Losing weight' : strDown ? 'Losing fat + some muscle' : 'Losing fat'
    } else {
      verdict = strengthTrend == null ? 'Gaining weight' : strUp ? 'Gaining muscle' : 'Gaining mostly fat'
    }
    // BF%: prefer a tape measurement (US Navy) from the last 30 days, else Deurenberg BMI estimate
    let bf: { fatPct: number; leanLbs: number; fatLbs: number; source: string } | null = null
    const latestTape = bodyMeasurements.length ? bodyMeasurements[bodyMeasurements.length - 1] : null
    const tapeFresh = latestTape && (Date.now() - new Date(latestTape.date_key).getTime()) < 30 * 86400000
    if (tapeFresh && latestTape) {
      const fatPct = latestTape.bf_pct
      const [, m, d] = latestTape.date_key.split('-')
      bf = { fatPct, leanLbs: currentWeight * (1 - fatPct / 100), fatLbs: currentWeight * (fatPct / 100), source: `taped ${MONS[parseInt(m) - 1]} ${parseInt(d)}` }
    } else if (healthProfile?.height_cm && healthProfile.age && healthProfile.sex) {
      const heightM = healthProfile.height_cm / 100
      const weightKg = currentWeight * 0.453592
      const bmi = weightKg / (heightM * heightM)
      const sexFactor = healthProfile.sex === 'm' ? 1 : healthProfile.sex === 'f' ? 0 : 0.5
      const fatPct = Math.max(5, Math.min(50, (1.20 * bmi) + (0.23 * healthProfile.age) - (10.8 * sexFactor) - 5.4))
      bf = { fatPct, leanLbs: currentWeight * (1 - fatPct / 100), fatLbs: currentWeight * (fatPct / 100), source: 'est.' }
    }
    return { weeklyRate, verdict, strengthTrend, bf }
  })()

  // Nudge to re-tape when weight has drifted ≥2 lbs since the last tape measurement
  const lastTape = bodyMeasurements.length ? bodyMeasurements[bodyMeasurements.length - 1] : null
  const weightAtLastTape = lastTape
    ? bodyWeights.filter(w => w.date_key <= lastTape.date_key).slice(-1)[0]?.weight ?? null
    : null
  const sinceTapeDelta = lastTape && weightAtLastTape != null && currentWeight != null
    ? currentWeight - weightAtLastTape
    : null
  const measureNudge = !nudgeDismissed && sinceTapeDelta != null && Math.abs(sinceTapeDelta) >= 2
  const goalIsLoss = targetWeight != null && currentWeight != null ? targetWeight < currentWeight : true
  function bwDeltaColor(delta: number): string {
    if (delta === 0) return 'text-white/40'
    const goodDirection = goalIsLoss ? delta < 0 : delta > 0
    return goodDirection ? 'text-green-400' : 'text-red-400'
  }

  // Today's full workout summary
  const todayAllLogs = allLogs.filter(l => logDatePST(l.logged_at) === today)
  const todayExIds = [...new Set(todayAllLogs.map(l => l.exercise_id))]
  const todayVolume = todayAllLogs.reduce((s, l) => s + l.weight * l.reps, 0)

  // Fetch matching Whoop workout strain. Tries on load (logs present) and again when
  // the user finishes — Whoop may not have synced until then. Expands window ±30 min
  // to catch Whoop sessions that started before the first logged set.
  function fetchWhoopStrain() {
    if (todayAllLogs.length === 0) return
    const sorted = todayAllLogs.slice().sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const startMs = new Date(sorted[0].logged_at).getTime() - 30 * 60 * 1000
    const endMs = new Date(sorted[sorted.length - 1].logged_at).getTime() + 30 * 60 * 1000
    const start = encodeURIComponent(new Date(startMs).toISOString())
    const end = encodeURIComponent(new Date(endMs).toISOString())
    fetch(`/api/health/whoop/workout?start=${start}&end=${end}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.strain != null) setWhoopWorkoutStrain(data.strain) })
      .catch(() => {})
  }

  useEffect(() => {
    if (whoopStrainFetched.current) return
    if (todayAllLogs.length === 0) return
    whoopStrainFetched.current = true
    fetchWhoopStrain()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayAllLogs])

  useEffect(() => {
    if (!todayDone) return
    // Retry when finishing — Whoop likely synced by now
    fetchWhoopStrain()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayDone])

  // Past workouts (for history)
  const pastDates = [...new Set(
    allLogs.filter(l => logDatePST(l.logged_at) !== today).map(l => logDatePST(l.logged_at))
  )].sort((a, b) => b.localeCompare(a)).slice(0, 10)

  return (
    <>
    <div className="nebula-gym min-h-screen bg-black text-white pb-28">
      {/* Day Pill */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-2 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={openRotModal}
            className="flex items-center gap-2 rounded-full bg-white/8 border border-white/10 px-4 py-2 active:opacity-70"
          >
            <span className="text-xs text-white/50 font-mono tracking-widest">{todayDateLabel()}</span>
            <motion.span
              className="text-xs font-bold tracking-widest"
              style={{ color: isRest(split.name) ? '#7DD3FC' : '#4ade80' }}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: isRest(split.name) ? 0.6 : 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
            >
              {splitLabel(split.name)}
            </motion.span>
          </button>
          <button
            onClick={openSettings}
            className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white/70 active:opacity-70"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
        {todaysCall && (() => {
          const clr = todaysCall.color === 'GREEN' ? '#4ade80' : todaysCall.color === 'YELLOW' ? '#fbbf24' : '#f87171'
          return (
            <div className="mt-2 flex items-center gap-2 px-1">
              <span className="text-[10px] font-bold tracking-widest" style={{ color: clr }}>{todaysCall.color}</span>
              <span className="text-[11px] text-white/50 truncate">{todaysCall.headline}</span>
            </div>
          )
        })()}
      </div>

      <div className="px-4 space-y-4 pt-2">

        {/* ── Body Weight Tracker ────────────────────────────────────── */}
        <motion.section
          className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden"
          style={{ backdropFilter: 'blur(8px)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.3 }}
        >
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-end justify-between mb-1">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <p className="text-xs text-white/40 uppercase tracking-widest">Body Weight</p>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums">
                    {bodyWeights.length ? bodyWeights[bodyWeights.length - 1].weight.toFixed(1) : '—'}
                  </span>
                  <span className="text-sm text-white/40">{config.units}</span>
                  {bwDelta != null && bodyWeights.length >= 2 && (
                    <span className={`text-sm font-medium ${bwDeltaColor(bwDelta)}`}>
                      {bwDelta > 0 ? '+' : ''}{bwDelta.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
              {bodyWeights.length >= 2 && (
                <div className="text-right text-xs text-white/30">
                  <div>{bodyWeights.length} entries</div>
                  {bwDelta != null && (
                    <div>all-time {bwDelta > 0 ? '+' : ''}{bwDelta.toFixed(1)}</div>
                  )}
                </div>
              )}
            </div>
          </div>

          {bodyWeights.length >= 2 && (
            <div className="px-4">
              <WtChart entries={bodyWeights} units={config.units} />
            </div>
          )}

          {compEstimate && (
            <div className="mx-5 mt-3 mb-4 cosmic-card px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">{compEstimate.verdict}</span>
                <span className="text-[10px] text-white/30">
                  {compEstimate.weeklyRate > 0 ? '+' : ''}{compEstimate.weeklyRate.toFixed(2)} lbs/wk
                  {compEstimate.strengthTrend != null && (
                    <> · str {compEstimate.strengthTrend >= 0 ? '↑' : '↓'}{Math.abs(compEstimate.strengthTrend * 100).toFixed(1)}%</>
                  )}
                </span>
              </div>
              {compEstimate.bf && (
                <>
                  <div className="flex rounded-full overflow-hidden h-2">
                    <div className="bg-blue-400/80" style={{ width: `${(100 - compEstimate.bf.fatPct).toFixed(1)}%` }} />
                    <div className="bg-yellow-400/80" style={{ width: `${compEstimate.bf.fatPct.toFixed(1)}%` }} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-white/30">
                      <span className="text-blue-300/70">~{compEstimate.bf.leanLbs.toFixed(1)} lbs lean</span>
                      {' · '}
                      <span className="text-yellow-300/70">~{compEstimate.bf.fatLbs.toFixed(1)} lbs fat</span>
                      {' · '}~{compEstimate.bf.fatPct.toFixed(1)}% BF ({compEstimate.bf.source})
                    </p>
                    <button
                      onClick={openMeasureModal}
                      className="text-[10px] text-white/40 active:opacity-60 shrink-0"
                    >
                      tape BF%
                    </button>
                  </div>
                </>
              )}
              {!compEstimate.bf && (
                <button
                  onClick={openMeasureModal}
                  className="text-[10px] text-white/40 active:opacity-60"
                >
                  measure body fat % with a tape
                </button>
              )}
              {measureNudge && sinceTapeDelta != null && (
                <div className="flex items-center justify-between gap-2 rounded-lg bg-blue-400/10 border border-blue-400/20 px-3 py-2">
                  <span className="text-[11px] text-blue-200/80">
                    {sinceTapeDelta < 0 ? 'Down' : 'Up'} {Math.abs(sinceTapeDelta).toFixed(1)} lbs since your last tape — update your BF%?
                  </span>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={openMeasureModal}
                      className="text-[11px] font-semibold text-blue-300 active:opacity-60"
                    >
                      Measure
                    </button>
                    <button onClick={() => setNudgeDismissed(true)} className="text-[11px] text-white/30 active:opacity-60">✕</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="px-5 pb-5 pt-3">
            {todayBw ? (
              <div className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-3">
                <div>
                  <p className="text-xs text-white/40">Logged today</p>
                  <p className="text-base font-semibold">{todayBw.weight.toFixed(1)} {config.units}</p>
                </div>
                <button
                  onClick={() => { setBwInput(String(todayBw.weight)); }}
                  className="text-xs text-white/40 underline active:opacity-60"
                >
                  edit
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={bwInput}
                    onFocus={e => e.target.select()}
                    onChange={e => setBwInput(e.target.value)}
                    placeholder={`Weight in ${config.units}`}
                    className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-base text-white placeholder:text-white/20 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      const w = parseFloat(bwInput)
                      if (!w || w <= 0) return
                      logBw.mutate({ date_key: today, weight: w }, { onSuccess: () => setBwInput('') })
                    }}
                    disabled={!bwInput || logBw.isPending}
                    className="rounded-xl bg-white/10 border border-white/10 px-5 py-3 text-sm font-semibold active:opacity-70 disabled:opacity-40"
                  >
                    {logBw.isPending ? '…' : 'Log'}
                  </button>
                </div>
                {logBw.isError && (
                  <p className="text-xs text-red-400 px-1">
                    Failed — have you run the DB migration?
                  </p>
                )}
              </div>
            )}
          </div>
        </motion.section>

        {/* ── Progress Photos Card ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.35 }}
        >
          <button
            onClick={() => { setShowPhotos(true); setPhotoMode('grid') }}
            className="w-full rounded-2xl bg-[#111113] border px-5 py-[18px] flex items-center justify-between"
            style={{ borderColor: 'rgba(110,231,183,0.10)', backdropFilter: 'blur(8px)' }}
          >
            <div className="text-left">
              <p className="text-xs text-white/40 uppercase tracking-[0.20em] font-semibold mb-1">Progress Photos</p>
              <p className="text-sm font-medium">{photos.length} photo{photos.length !== 1 ? 's' : ''}</p>
            </div>
            <span style={{ color: '#6ee7b7', fontSize: 20 }}>→</span>
          </button>
        </motion.div>

        {/* ── Coach ─────────────────────────────────────────────────── */}
        <motion.section
          className="rounded-2xl overflow-hidden"
          style={{ background: 'rgba(74,222,128,0.03)', backdropFilter: 'blur(8px)', border: '1px solid rgba(74,222,128,0.15)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.2 }}
        >
          <div className="flex">
            <motion.button
              onClick={() => streamCoach('angel')}
              disabled={coachStreaming}
              whileTap={{ scale: 0.97 }}
              className={`flex-1 flex flex-col items-center justify-center py-4 gap-1 transition-colors active:opacity-70 disabled:opacity-50 ${
                coachMode === 'angel' ? 'bg-emerald-950/60' : 'bg-white/5'
              }`}
            >
              <span className="text-2xl">😇</span>
              <span className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">
                {coachStreaming && coachMode === 'angel' ? 'Talking…' : 'Hype me up'}
              </span>
            </motion.button>
            <div className="w-px bg-white/8" />
            <motion.button
              onClick={() => streamCoach('devil')}
              disabled={coachStreaming}
              whileTap={{ scale: 0.97 }}
              className={`flex-1 flex flex-col items-center justify-center py-4 gap-1 transition-colors active:opacity-70 disabled:opacity-50 ${
                coachMode === 'devil' ? 'bg-red-950/60' : 'bg-white/5'
              }`}
            >
              <span className="text-2xl">😈</span>
              <span className="text-xs font-semibold tracking-widest text-red-400 uppercase">
                {coachStreaming && coachMode === 'devil' ? 'Talking…' : 'Yell at me'}
              </span>
            </motion.button>
          </div>
          <AnimatePresence mode="wait">
            {coachStreaming && !coachText && (
              <motion.div
                key="orb"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-5 py-4 border-t border-white/8"
              >
                <div className="inline-flex items-center gap-2 rounded-full px-4 py-2.5" style={{ background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)' }}>
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <motion.span
                      key={i}
                      className="block rounded-full"
                      style={{ width: 7, height: 7, background: '#4ade80', boxShadow: '0 0 6px rgba(74,222,128,0.35)' }}
                      animate={{ opacity: [0.25, 1, 0.25], scale: [0.75, 1, 0.75] }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay }}
                    />
                  ))}
                  <span className="text-xs font-mono text-green-400 tracking-wider ml-1">Atlas is thinking</span>
                </div>
              </motion.div>
            )}
            {coachText && (
              <motion.div
                key="text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className={`px-5 py-4 border-t border-white/8 ${coachMode === 'devil' ? 'bg-red-950/30' : 'bg-emerald-950/30'}`}
              >
                <p className="text-sm leading-relaxed text-white/90">{coachText}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        {/* ── PO Coach ──────────────────────────────────────────────── */}
        <motion.section
          className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden"
          style={{ backdropFilter: 'blur(8px)' }}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT, delay: 0.1 }}
        >
          <div className="px-5 pt-5 pb-4 relative">
            <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '22px 22px', borderRadius: 'inherit' }} />
            <p className="text-xs text-white/40 uppercase tracking-widest mb-4">Progressive Overload Coach</p>

            {/* Gym filter */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 w-10 flex-shrink-0">GYM</span>
              <div className="flex-1 flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1">
                {config.gyms.map((g, i) => (
                  <motion.button
                    key={g.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.15 + i * 0.06 }}
                    onClick={() => setFilterGym(g.id)}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      filterGym === g.id
                        ? 'bg-white text-black shadow-sm'
                        : 'text-white/40'
                    }`}
                  >
                    {g.name}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Day filter */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 w-10 flex-shrink-0">DAY</span>
              <div className="flex-1 flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1">
                {config.days.map((d, i) => (
                  <motion.button
                    key={d.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.32, ease: EASE_OUT, delay: 0.2 + i * 0.06 }}
                    onClick={() => setFilterDay(d.id)}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      filterDay === d.id
                        ? 'bg-white text-black shadow-sm'
                        : 'text-white/40'
                    }`}
                  >
                    {d.name}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Exercise chips */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30">Exercise</span>
                <div className="flex items-center gap-3">
                  {filteredExercises.length > 1 && (
                    <button onClick={() => setReorderOpen(true)} className="text-[11px] text-white/30 font-mono active:opacity-50">
                      reorder
                    </button>
                  )}
                  {currentEx && (
                    <button onClick={openEditEx} className="text-[11px] text-white/30 font-mono active:opacity-50">
                      edit
                    </button>
                  )}
                  <button onClick={openAddEx} className="text-[11px] font-semibold active:opacity-50" style={{ color: 'rgba(74,222,128,0.7)' }}>
                    + add
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto -mx-5 px-5 pb-0.5" style={{ scrollbarWidth: 'none' }}>
                <div className="flex gap-2 min-w-max">
                  {filteredExercises.length === 0 ? (
                    <button
                      onClick={openAddEx}
                      className="px-4 py-2.5 rounded-xl border border-dashed text-white/25 text-sm whitespace-nowrap"
                      style={{ borderColor: 'rgba(255,255,255,0.12)' }}
                    >
                      No exercises — add one
                    </button>
                  ) : (
                    filteredExercises.map((ex) => (
                      <ScrollChip
                        key={ex.id}
                        ex={ex}
                        isActive={currentEx?.id === ex.id}
                        onSelect={selectEx}
                        onLongPress={() => setReorderOpen(true)}
                      />
                    ))
                  )}
                </div>
              </div>
              {reorderOpen && (
                <ReorderSheet
                  items={filteredExercises}
                  onClose={() => setReorderOpen(false)}
                  onSave={saveExerciseOrder}
                />
              )}
            </div>

            {currentEx && (
              <motion.div
                className="mt-2"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 16,
                  padding: '16px',
                  border: rx?.action === 'INCREASE' ? '1px solid rgba(74,222,128,0.15)' : '1px solid rgba(255,255,255,0.08)',
                }}
                initial={{ opacity: 0, y: 12 }}
                animate={{
                  opacity: 1,
                  y: 0,
                  boxShadow: rx?.action === 'INCREASE'
                    ? ['0 0 0px rgba(74,222,128,0)', '0 0 16px rgba(74,222,128,0.15)', '0 0 0px rgba(74,222,128,0)']
                    : '0 0 0px rgba(0,0,0,0)',
                }}
                transition={rx?.action === 'INCREASE'
                  ? { opacity: { duration: 0.4, ease: EASE_OUT }, y: { duration: 0.4, ease: EASE_OUT }, boxShadow: { duration: 3, repeat: Infinity, ease: 'easeInOut' } }
                  : { duration: 0.4, ease: EASE_OUT }
                }
              >
                {/* Exercise hero */}
                <div className="mb-5">
                  <div className="flex items-start justify-between gap-3">
                    <motion.h2
                      key={currentEx.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.3, ease: EASE_OUT }}
                      className="text-2xl font-bold text-white leading-tight"
                    >
                      {currentEx.name}
                    </motion.h2>
                    {rx && (
                      <motion.span
                        key={rx.action}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3, ease: [0.34, 1.56, 0.64, 1], delay: 0.1 }}
                        className="shrink-0 text-[10px] font-bold tracking-widest px-2.5 py-1.5 rounded-full"
                        style={rx.action === 'INCREASE' ? {
                          background: 'rgba(74,222,128,0.15)', color: '#4ade80',
                          border: '1px solid rgba(74,222,128,0.3)',
                          boxShadow: '0 0 10px rgba(74,222,128,0.15)',
                        } : rx.action === 'HOLD' ? {
                          background: 'rgba(251,191,36,0.12)', color: '#fbbf24',
                          border: '1px solid rgba(251,191,36,0.25)',
                        } : rx.action === 'DELOAD' ? {
                          background: 'rgba(248,113,113,0.12)', color: '#f87171',
                          border: '1px solid rgba(248,113,113,0.25)',
                        } : {
                          background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)',
                          border: '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        {rxIcons[rx.action]} {rx.action}
                      </motion.span>
                    )}
                  </div>
                  {lastLog && (
                    <p className="text-xs text-white/30 font-mono mt-1.5">
                      Last: {currentEx.bodyweight ? `${lastLog.reps} reps` : `${lastLog.weight}${config.units} × ${lastLog.reps}`}
                      <span className="text-white/20 ml-1.5">· {lastLogAgo}</span>
                    </p>
                  )}
                </div>

                {/* Weight stepper */}
                {!currentEx.bodyweight && (
                  <div className="mb-5">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30">Weight</span>
                      <span className="text-[10px] text-white/20 font-mono">+{currentEx.step} {config.units} / step</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <motion.button
                        whileTap={{ scale: 0.85 }}
                        onClick={() => setWeightInput(w => {
                          const next = Math.max(0, (parseFloat(w) || 0) - currentEx.step)
                          return +next.toFixed(4) === 0 ? '0' : String(+next.toFixed(4))
                        })}
                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-light text-white/50 shrink-0"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
                      >−</motion.button>
                      <div className="flex-1 text-center">
                        <input
                          type="number"
                          inputMode="decimal"
                          step={currentEx.step}
                          value={weightInput}
                          onFocus={e => e.target.select()}
                          onChange={e => setWeightInput(e.target.value)}
                          className="w-full text-center text-5xl font-bold bg-transparent focus:outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <p className="text-xs text-white/25 -mt-1 font-mono tracking-widest">{config.units}</p>
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.85 }}
                        onClick={() => setWeightInput(w => String(+((parseFloat(w) || 0) + currentEx.step).toFixed(4)))}
                        className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-light shrink-0"
                        style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80' }}
                      >+</motion.button>
                    </div>
                  </div>
                )}

                {/* Reps slider */}
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30">Reps</label>
                    <span className="text-2xl font-bold tabular-nums">{selectedReps}</span>
                  </div>
                  <input
                    type="range"
                    min={3}
                    max={20}
                    step={1}
                    value={selectedReps}
                    onChange={e => setSelectedReps(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #4ade80 ${((selectedReps - 3) / (20 - 3)) * 100}%, rgba(255,255,255,0.12) 0%)`,
                      WebkitAppearance: 'none',
                    }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-white/20">3</span>
                    <span className="text-xs text-white/20 font-mono">{repMin}–{repMax} target</span>
                    <span className="text-xs text-white/20">20</span>
                  </div>
                </div>

                {/* Active / Rest timer */}
                <div className="mb-5">
                  <AnimatePresence>
                    {timer.phase !== 'idle' && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: EASE_OUT }}
                        className="flex items-center justify-center gap-2 mb-3"
                      >
                        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 font-mono">
                          Session · {fmtClock(sessionMs)}
                        </span>
                        <button
                          onClick={endSession}
                          className="text-[9px] font-semibold tracking-widest uppercase text-white/30 px-1.5 py-0.5 rounded-md border border-white/10 active:opacity-60"
                        >
                          End
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <SetTimerRing phase={timer.phase} ms={phaseMs} />
                </div>

                {/* Start / End Set button */}
                <motion.button
                  onClick={handleSetButton}
                  disabled={logSet.isPending}
                  whileTap={{ scale: 0.93 }}
                  animate={{
                    boxShadow: logSetFlash
                      ? '0 0 28px rgba(74,222,128,0.45), 0 0 8px rgba(74,222,128,0.3)'
                      : '0 0 0px rgba(74,222,128,0)',
                  }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                  className="w-full rounded-2xl font-bold py-4 text-base disabled:opacity-50 relative overflow-hidden"
                  style={{
                    background: logSetFlash
                      ? 'rgba(74,222,128,0.2)'
                      : timer.phase === 'active'
                      ? 'rgba(255,255,255,0.04)'
                      : 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)',
                    color: logSetFlash ? '#4ade80' : timer.phase === 'active' ? '#fff' : '#000',
                    border: logSetFlash
                      ? '1px solid rgba(74,222,128,0.4)'
                      : timer.phase === 'active'
                      ? '1px solid rgba(255,255,255,0.22)'
                      : 'none',
                  }}
                >
                  {logSet.isPending ? '…' : timer.phase === 'active' ? 'End Set' : 'Start Set'}
                </motion.button>

                {/* Prescription card */}
                {rx && (
                  <motion.div
                    key={rx.action}
                    initial={{ opacity: 0, y: 8, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
                    className="mt-4 rounded-2xl overflow-hidden"
                    style={{
                      background: rx.action === 'INCREASE'
                        ? 'linear-gradient(135deg, rgba(74,222,128,0.12) 0%, rgba(74,222,128,0.03) 100%)'
                        : rx.action === 'HOLD'
                        ? 'linear-gradient(135deg, rgba(251,191,36,0.10) 0%, rgba(251,191,36,0.02) 100%)'
                        : rx.action === 'DELOAD'
                        ? 'linear-gradient(135deg, rgba(248,113,113,0.12) 0%, rgba(248,113,113,0.03) 100%)'
                        : 'rgba(255,255,255,0.04)',
                      border: rx.action === 'INCREASE'
                        ? '1px solid rgba(74,222,128,0.22)'
                        : rx.action === 'HOLD'
                        ? '1px solid rgba(251,191,36,0.22)'
                        : rx.action === 'DELOAD'
                        ? '1px solid rgba(248,113,113,0.22)'
                        : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div className="px-5 py-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-base font-bold tracking-wide ${rxColors[rx.action].split(' ')[0]}`}>
                          {rxIcons[rx.action]} {rx.action}
                        </span>
                        {rx.action === 'INCREASE' && (
                          <span className="text-[9px] font-bold tracking-widest px-2 py-1 rounded-full"
                            style={{ background: 'rgba(74,222,128,0.15)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)' }}>
                            LEVEL UP
                          </span>
                        )}
                      </div>
                      <p className={`text-sm leading-relaxed ${rxColors[rx.action].split(' ')[0] === 'text-green-400' ? 'text-green-200/60' : rxColors[rx.action].split(' ')[0] === 'text-yellow-400' ? 'text-yellow-200/60' : rxColors[rx.action].split(' ')[0] === 'text-red-400' ? 'text-red-200/60' : 'text-white/40'}`}>
                        {rx.reason}
                      </p>
                      {rx.nextWeight != null && (
                        <p className="text-xs mt-2 font-mono text-white/35">→ next: {rx.nextWeight} {config.units}</p>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Best set + trend — side by side to stay compact */}
                {bestSet && (
                  <div className="mt-5 flex gap-3 items-stretch">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, ease: EASE_OUT }}
                      className={`rounded-xl px-4 py-3.5 flex flex-col justify-center text-center ${exLogs.length >= 2 ? 'basis-2/5 shrink-0' : 'mx-auto px-10'}`}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <p className="text-[10px] text-white/30 uppercase tracking-widest font-semibold mb-1">Best set</p>
                      <p className="text-lg font-bold tabular-nums">
                        {currentEx.bodyweight ? `${bestSet.reps} reps` : `${bestSet.weight}×${bestSet.reps}`}
                      </p>
                    </motion.div>

                    {exLogs.length >= 2 && (
                      <motion.div
                        className="flex-1 min-w-0 rounded-xl bg-white/5 border border-white/8 overflow-hidden flex flex-col"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: EASE_OUT }}
                      >
                        <p className="text-[10px] text-white/30 uppercase tracking-widest px-3 pt-3 pb-1 shrink-0">Trend</p>
                        <div className="flex-1 flex items-end">
                          <PoSparkline logs={exLogs} bodyweight={currentEx.bodyweight} />
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

              </motion.div>
            )}

            {filteredExercises.length === 0 && (
              <div className="text-center py-8">
                <p className="text-white/30 text-sm mb-4">No exercises for this filter</p>
                <button
                  onClick={openAddEx}
                  className="rounded-xl bg-white/8 border border-white/10 px-5 py-3 text-sm font-medium active:opacity-70"
                >
                  Add exercise
                </button>
              </div>
            )}
          </div>
        </motion.section>

        {/* ── Today's Workout ───────────────────────────────────── */}
        {todayAllLogs.length > 0 && (
          <section>
            <div className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden" style={{ backdropFilter: 'blur(8px)' }}>
              {/* Header — div not button to avoid nesting issue with Finish Workout button */}
              <div
                role="button"
                onClick={() => setTodayExpanded(e => !e)}
                className="w-full flex items-center justify-between px-5 py-4 cursor-pointer active:opacity-70"
              >
                <div>
                  <p className="text-xs text-white/40 uppercase tracking-widest font-semibold mb-0.5">
                    Today's Workout — {todayDateLabel()}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold tabular-nums">{todayAllLogs.length}</span>
                    <span className="text-sm text-white/40">sets</span>
                    <span className="text-white/20">·</span>
                    <span className="text-sm text-white/60">{Math.round(todayVolume).toLocaleString()} {config.units}</span>
                    {whoopWorkoutStrain != null && (
                      <>
                        <span className="text-white/20">·</span>
                        <span className="text-sm font-semibold" style={{ color: whoopWorkoutStrain >= 16 ? '#f87171' : whoopWorkoutStrain >= 10 ? '#fb923c' : '#4ade80' }}>
                          {whoopWorkoutStrain.toFixed(1)} strain
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-white/30 text-xs ml-4 shrink-0">{todayExpanded ? '▲' : '▼'}</span>
              </div>

              {/* Individual sets per exercise */}
              {todayExpanded && (
                <div className="border-t border-white/6">
                  {todayExIds.map(exId => {
                    const ex = exercises.find(e => e.id === exId)
                    const sets = todayAllLogs
                      .filter(l => l.exercise_id === exId)
                      .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
                    return (
                      <div key={exId} className="px-5 py-3 border-b border-white/5 last:border-b-0">
                        <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                          {ex?.name ?? 'Exercise'}
                        </p>
                        <div className="space-y-1">
                          {sets.map((set, i) => (
                            <div key={set.id} className="flex items-center gap-3 text-sm">
                              <span className="w-4 text-white/20 tabular-nums text-xs">{i + 1}</span>
                              <span className="flex-1 text-white/80 tabular-nums">
                                {ex?.bodyweight ? 'BW' : `${set.weight} ${config.units}`}
                                {' × '}
                                {set.reps}
                              </span>
                              <button
                                onClick={() => deleteLog.mutate({ id: set.id, exerciseId: set.exercise_id })}
                                className="text-white/40 hover:text-red-400 active:text-red-400 text-base leading-none transition-colors px-1"
                                aria-label="Delete set"
                              >×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Finish Workout — always visible */}
              <div className="px-5 py-4 border-t border-white/6">
                <button
                  onClick={() => setTodayDone(d => {
                    const next = !d
                    if (next) endSession() // finishing the workout resets the set timer to idle
                    return next
                  })}
                  className={`w-full rounded-xl py-3.5 text-sm font-bold transition-all active:scale-[0.98] ${
                    todayDone
                      ? 'bg-green-500/20 border border-green-500/40 text-green-400'
                      : 'bg-white text-black'
                  }`}
                >
                  {todayDone ? '✓ Done for today' : 'Finish Workout'}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Neck & Jaw Protocol Card ──────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: EASE_OUT, delay: 0.5 }}
        >
          <ProtocolCard today={today} />
        </motion.div>

        {/* ── Past Workouts ─────────────────────────────────────────── */}
        {pastDates.length > 0 && (
          <section>
            <button
              onClick={() => setPastExpanded(e => !e)}
              className="w-full rounded-2xl bg-white/5 border border-white/8 px-5 py-4 flex items-center justify-between active:opacity-70"
              style={{ backdropFilter: 'blur(8px)' }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-white/70">Past workouts</span>
                <span className="text-xs font-bold bg-white/10 text-white/50 rounded-full px-2 py-0.5">{pastDates.length}</span>
              </div>
              <span className="text-white/30 text-xs">{pastExpanded ? '▲' : '▼'}</span>
            </button>
            {pastExpanded && (
              <div className="mt-2 space-y-2">
                {pastDates.map(date => {
                  const dateLogs = allLogs.filter(l => logDatePST(l.logged_at) === date)
                  const dateExIds = [...new Set(dateLogs.map(l => l.exercise_id))]
                  const dateVol = dateLogs.reduce((s, l) => s + l.weight * l.reps, 0)
                  const [y, m, d] = date.split('-').map(Number)
                  const dt = new Date(y, m - 1, d)
                  const label = DOWS[dt.getDay()] + ', ' + MONS[m - 1] + ' ' + d
                  return (
                    <div key={date} className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden" style={{ backdropFilter: 'blur(8px)' }}>
                      {/* Day header */}
                      <div className="flex items-center justify-between px-5 py-3 border-b border-white/6">
                        <span className="text-xs font-semibold text-white/50 uppercase tracking-wider">{label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-white/30 tabular-nums">
                            {dateLogs.length} sets · {Math.round(dateVol).toLocaleString()} {config.units}
                          </span>
                          <button
                            onClick={() => dateLogs.forEach(l => deleteLog.mutate({ id: l.id, exerciseId: l.exercise_id }))}
                            className="text-white/20 hover:text-red-400 active:text-red-400 transition-colors"
                            aria-label="Delete workout"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* Individual sets per exercise */}
                      {dateExIds.map(exId => {
                        const ex = exercises.find(e => e.id === exId)
                        const sets = dateLogs
                          .filter(l => l.exercise_id === exId)
                          .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
                        return (
                          <div key={exId} className="px-5 py-3 border-b border-white/5 last:border-b-0">
                            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                              {ex?.name ?? 'Exercise'}
                            </p>
                            <div className="space-y-1">
                              {sets.map((set, i) => (
                                <div key={set.id} className="flex items-center gap-3 text-sm">
                                  <span className="w-4 text-white/20 tabular-nums text-xs">{i + 1}</span>
                                  <span className="flex-1 text-white/70 tabular-nums">
                                    {ex?.bodyweight ? 'BW' : `${set.weight} ${config.units}`}
                                    {' × '}
                                    {set.reps}
                                  </span>
                                  <button
                                    onClick={() => deleteLog.mutate({ id: set.id, exerciseId: set.exercise_id })}
                                    className="text-white/20 hover:text-red-400 active:text-red-400 text-base leading-none transition-colors"
                                    aria-label="Delete set"
                                  >×</button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        )}

      </div>

      {/* hidden file inputs */}
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handlePhotoFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handlePhotoFile(file)
          e.target.value = ''
        }}
      />

    </div>
    {mounted && createPortal(
      <>
      {/* ── Progress Photos Overlay ─────────────────────────────────── */}
      {showPhotos && !viewPhoto && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Header */}
          <div className="px-4 pt-safe pt-4 pb-3 border-b border-white/8 space-y-3">
            <div className="flex items-center justify-between">
              <button onClick={() => setShowPhotos(false)} className="text-white/50 text-sm active:opacity-60">← Back</button>
              <div className="flex gap-1 rounded-full bg-white/8 p-0.5">
                {(['grid', 'compare'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setPhotoMode(m)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
                      photoMode === m
                        ? 'text-black'
                        : 'text-white/40'
                    }`}
                    style={photoMode === m ? { background: 'linear-gradient(135deg, #fff 0%, #e5e5e5 100%)' } : {}}
                  >
                    {m === 'grid' ? 'Photos' : 'Compare'}
                  </button>
                ))}
              </div>
              <div className="w-16" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={uploadPhoto.isPending}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-black active:opacity-80 disabled:opacity-40"
                style={{ background: 'linear-gradient(180deg, #6ee7b7 0%, #34d399 100%)' }}
              >
                📷 Take Photo
              </button>
              <button
                onClick={() => libraryInputRef.current?.click()}
                disabled={uploadPhoto.isPending}
                className="flex-1 rounded-xl py-3 text-sm font-semibold text-white/80 bg-white/10 border border-white/10 active:opacity-70 disabled:opacity-40"
              >
                From Library
              </button>
            </div>
          </div>

          {photos.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-white/30">
              <p className="text-sm">{uploadPhoto.isPending ? 'Uploading…' : 'No progress photos yet'}</p>
            </div>
          ) : photoMode === 'grid' ? (
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-3 gap-0.5 p-0.5">
                {photos.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setViewPhoto(p)}
                    className="aspect-square overflow-hidden bg-white/5 active:opacity-80"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.date} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Compare mode */
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {photos.length < 2 ? (
                <p className="text-center text-white/30 text-sm mt-8">Add at least 2 photos to compare</p>
              ) : (
                <>
                  <div className="flex gap-2">
                    {([0, 1] as const).map(slot => (
                      <div key={slot} className="flex-1 space-y-1">
                        <select
                          value={compareIdx[slot]}
                          onChange={e => setCompareIdx(ci => slot === 0 ? [Number(e.target.value), ci[1]] : [ci[0], Number(e.target.value)])}
                          className="w-full rounded-lg bg-white/8 border border-white/10 px-2 py-1.5 text-xs text-white appearance-none focus:outline-none"
                        >
                          {photos.map((p, i) => (
                            <option key={p.id} value={i}>{p.date}</option>
                          ))}
                        </select>
                        <div className="aspect-[3/4] overflow-hidden rounded-xl bg-white/5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photos[compareIdx[slot]]?.url} alt="" className="w-full h-full object-cover" />
                        </div>
                        <div className="text-center text-xs text-white/40">
                          {photos[compareIdx[slot]]?.weight
                            ? `${photos[compareIdx[slot]].weight} ${photos[compareIdx[slot]].weight_unit ?? config.units}`
                            : '—'
                          }
                        </div>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const a = photos[compareIdx[0]]
                    const b = photos[compareIdx[1]]
                    if (!a?.weight || !b?.weight) return null
                    const delta = b.weight - a.weight
                    return (
                      <p className={`text-center text-sm font-semibold ${delta < 0 ? 'text-green-400' : delta > 0 ? 'text-red-400' : 'text-white/40'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)} {config.units}
                      </p>
                    )
                  })()}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Single Photo Viewer ─────────────────────────────────────── */}
      {viewPhoto && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3">
            <button onClick={() => setViewPhoto(null)} className="text-white/50 text-sm active:opacity-60">← Back</button>
            <div className="text-xs text-white/40">{viewPhoto.date}</div>
            <button
              onClick={() => {
                if (!confirm('Delete this photo?')) return
                deletePhotoMut.mutate(viewPhoto.id, { onSuccess: () => setViewPhoto(null) })
              }}
              disabled={deletePhotoMut.isPending}
              className="text-red-400 text-sm active:opacity-60 disabled:opacity-40"
            >
              {deletePhotoMut.isPending ? '…' : 'Delete'}
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewPhoto.url} alt={viewPhoto.date} className="max-w-full max-h-full object-contain rounded-xl" />
          </div>
          {viewPhoto.weight && (
            <div className="px-4 pb-8 text-center text-sm text-white/50">
              {viewPhoto.weight} {viewPhoto.weight_unit ?? config.units}
            </div>
          )}
        </div>
      )}

      {/* ── Tape Measurement Modal (US Navy BF%) ────────────────────── */}
      {showMeasureModal && (() => {
        const neck = parseFloat(neckIn)
        const waist = parseFloat(waistIn)
        const hip = parseFloat(hipIn)
        const needsHip = healthProfile?.sex === 'f'
        const hasProfile = !!healthProfile?.height_cm && !!healthProfile?.sex
        const inputsValid = neck > 0 && waist > 0 && (!needsHip || hip > 0)
        const bfPct = hasProfile && inputsValid
          ? navyBfPct(healthProfile!.height_cm!, healthProfile!.sex!, neck, waist, needsHip ? hip : null)
          : null
        const w = currentWeight
        const bmi = hasProfile && w ? (w * 0.453592) / Math.pow(healthProfile!.height_cm! / 100, 2) : null
        return (
          <div
            className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) setShowMeasureModal(false) }}
          >
            <div className="w-full rounded-t-3xl bg-[#111] border-t border-white/10 px-5 pt-5 pb-10 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-bold">Body fat — tape measure</h2>
                <button onClick={() => setShowMeasureModal(false)} className="text-white/40 text-sm active:opacity-60">✕</button>
              </div>
              <p className="text-[11px] text-white/35 mb-5">
                US Navy method. Measure at the narrowest point of your neck and at your navel, tape level and snug but not tight.
              </p>
              {!hasProfile ? (
                <p className="text-sm text-white/50">
                  Add your height and sex in the Health page profile first — the formula needs them.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className={`grid gap-3 ${needsHip ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Neck (in)</p>
                      <input
                        type="number" inputMode="decimal" step="0.25" value={neckIn}
                        onFocus={e => e.target.select()} onChange={e => setNeckIn(e.target.value)}
                        placeholder="15"
                        className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Waist (in)</p>
                      <input
                        type="number" inputMode="decimal" step="0.25" value={waistIn}
                        onFocus={e => e.target.select()} onChange={e => setWaistIn(e.target.value)}
                        placeholder="32"
                        className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
                      />
                    </div>
                    {needsHip && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1.5">Hip (in)</p>
                        <input
                          type="number" inputMode="decimal" step="0.25" value={hipIn}
                          onFocus={e => e.target.select()} onChange={e => setHipIn(e.target.value)}
                          placeholder="38"
                          className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  {bfPct != null && (
                    <div className="cosmic-card px-4 py-3 space-y-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold tabular-nums">{bfPct.toFixed(1)}%</span>
                        <span className="text-xs text-white/40">body fat</span>
                      </div>
                      <div className="flex rounded-full overflow-hidden h-2">
                        <div className="bg-blue-400/80" style={{ width: `${(100 - bfPct).toFixed(1)}%` }} />
                        <div className="bg-yellow-400/80" style={{ width: `${bfPct.toFixed(1)}%` }} />
                      </div>
                      <p className="text-[10px] text-white/30">
                        {w != null && (
                          <>
                            <span className="text-blue-300/70">~{(w * (1 - bfPct / 100)).toFixed(1)} lbs lean</span>
                            {' · '}
                            <span className="text-yellow-300/70">~{(w * (bfPct / 100)).toFixed(1)} lbs fat</span>
                          </>
                        )}
                        {bmi != null && <>{w != null ? ' · ' : ''}BMI {bmi.toFixed(1)}</>}
                      </p>
                    </div>
                  )}

                  <button
                    onClick={() => {
                      if (bfPct == null) return
                      logMeasurement.mutate(
                        { date_key: today, neck_in: neck, waist_in: waist, hip_in: needsHip ? hip : null, bf_pct: bfPct },
                        { onSuccess: () => setShowMeasureModal(false) }
                      )
                    }}
                    disabled={bfPct == null || logMeasurement.isPending}
                    className="w-full rounded-xl bg-white text-black font-semibold py-3 text-sm disabled:opacity-30 active:opacity-80"
                  >
                    {logMeasurement.isPending ? 'Saving…' : 'Save measurement'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Exercise Modal ──────────────────────────────────────────── */}
      {exModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setExModal(EMPTY_EX_MODAL) }}
        >
          <div className="w-full rounded-t-3xl bg-[#111] border-t border-white/10 px-5 pt-5 pb-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold">
                {exModal.mode === 'edit' ? 'Edit exercise' : 'Add exercise'}
              </h2>
              <button onClick={() => setExModal(EMPTY_EX_MODAL)} className="text-white/40 text-2xl leading-none">×</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Name</label>
                <input
                  autoFocus
                  value={exModal.name}
                  onChange={e => setExModal(m => ({ ...m, name: e.target.value }))}
                  placeholder="e.g. Bench Press"
                  className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Gym</label>
                <div className="flex gap-2 flex-wrap">
                  {config.gyms.map(g => (
                    <button key={g.id} onClick={() => setExModal(m => ({ ...m, gymId: g.id }))}
                      className={`rounded-full px-3 py-1.5 text-xs border ${exModal.gymId === g.id ? 'bg-white text-black border-transparent' : 'border-white/15 text-white/50'}`}>
                      {g.name}
                    </button>
                  ))}
                  <button onClick={() => setExModal(m => ({ ...m, gymId: 'both' }))}
                    className={`rounded-full px-3 py-1.5 text-xs border ${exModal.gymId === 'both' ? 'bg-white text-black border-transparent' : 'border-white/15 text-white/50'}`}>
                    Both
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-1">Days</label>
                <p className="text-[10px] text-white/25 mb-2">Select all days this exercise appears on</p>
                <div className="flex gap-2 flex-wrap">
                  {config.days.map(d => {
                    const selected = exModal.dayIds.includes(d.id)
                    return (
                      <button
                        key={d.id}
                        onClick={() => setExModal(m => ({
                          ...m,
                          dayIds: selected
                            ? m.dayIds.filter(id => id !== d.id)
                            : [...m.dayIds, d.id],
                        }))}
                        className={`rounded-full px-3 py-1.5 text-xs border transition-colors ${selected ? 'bg-green-400 text-black border-transparent' : 'border-white/15 text-white/50'}`}
                      >
                        {selected && <span className="mr-1">✓</span>}{d.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <div className={`w-10 h-6 rounded-full relative transition-colors ${exModal.bodyweight ? 'bg-green-400' : 'bg-white/15'}`}
                  onClick={() => setExModal(m => ({ ...m, bodyweight: !m.bodyweight }))}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${exModal.bodyweight ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
                <span className="text-sm text-white/70">Bodyweight exercise</span>
              </label>

              {!exModal.bodyweight && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Step ({config.units})</label>
                    <input type="number" inputMode="decimal" step="1.25" placeholder="0" value={exModal.step === 0 ? '' : exModal.step}
                      onFocus={e => e.target.select()} onChange={e => { const v = parseFloat(e.target.value); setExModal(m => ({ ...m, step: isNaN(v) ? 0 : v })) }}
                      className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                    <button
                      onClick={() => fetchCoachStep(exModal.name, exModal.bodyweight)}
                      disabled={coachStepLoading}
                      className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-black disabled:opacity-50 active:scale-[0.98] transition-transform"
                      style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55),0 2px 8px rgba(0,0,0,0.35)' }}
                    >
                      {coachStepLoading ? 'Asking coach…' : 'Let coach decide'}
                    </button>
                    {coachStepRec && (
                      <p className="text-[10px] text-white/30 mt-1 leading-relaxed">{coachStepRec.reason}</p>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Training goal</label>
                <div className="flex gap-2 mb-3">
                  {([
                    { label: 'Strength', min: 3, max: 5 },
                    { label: 'Hypertrophy', min: 8, max: 12 },
                    { label: 'Endurance', min: 15, max: 20 },
                  ] as const).map(g => (
                    <button
                      key={g.label}
                      onClick={() => setExModal(m => ({ ...m, repMin: g.min, repMax: g.max }))}
                      className={`flex-1 rounded-xl py-2 text-xs font-semibold border transition-colors ${
                        exModal.repMin === g.min && exModal.repMax === g.max
                          ? 'bg-white text-black border-transparent'
                          : 'bg-white/5 border-white/10 text-white/50'
                      }`}
                    >
                      {g.label}
                      <span className="block text-[10px] opacity-60 mt-0.5">{g.min}–{g.max}</span>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Rep min</label>
                    <input type="number" inputMode="numeric" value={exModal.repMin === 0 ? '' : exModal.repMin}
                      placeholder="0" onFocus={e => e.target.select()}
                      onChange={e => { const raw = e.target.value; setExModal(m => ({ ...m, repMin: raw === '' ? 0 : (parseInt(raw) ?? 0) })) }}
                      className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider block mb-1.5">Rep max</label>
                    <input type="number" inputMode="numeric" value={exModal.repMax === 0 ? '' : exModal.repMax}
                      placeholder="0" onFocus={e => e.target.select()}
                      onChange={e => { const raw = e.target.value; setExModal(m => ({ ...m, repMax: raw === '' ? 0 : (parseInt(raw) ?? 0) })) }}
                      className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              {exModal.mode === 'edit' && (
                <button
                  onClick={confirmDeleteEx}
                  className="rounded-xl border border-red-500/30 text-red-400 px-4 py-3 text-sm active:opacity-70"
                >
                  Delete
                </button>
              )}
              <button onClick={() => setExModal(EMPTY_EX_MODAL)}
                className="flex-1 rounded-xl bg-white/8 border border-white/10 py-3 text-sm active:opacity-70">
                Cancel
              </button>
              <button
                onClick={saveEx}
                disabled={!exModal.name.trim() || !exModal.gymId || !exModal.dayIds.length}
                className="flex-1 rounded-xl bg-white text-black font-bold py-3 text-sm active:opacity-70 disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rotation Editor Modal ───────────────────────────────────── */}
      {showRotation && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowRotation(false) }}
        >
          <div className="w-full rounded-t-3xl bg-[#111] border-t border-white/10 px-5 pt-5 pb-10 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold">Split Rotation</h2>
              <button onClick={() => setShowRotation(false)} className="text-white/40 text-2xl leading-none">×</button>
            </div>
            <p className="text-xs text-white/30 mb-4">Tap "Today is →" to anchor the cycle to today.</p>

            <div className="space-y-2 mb-4">
              {rotDraft.map((name, i) => (
                <div key={i} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${i === rotTodayIdx ? 'border-green-400/40 bg-green-400/5' : 'border-white/8 bg-white/3'}`}>
                  <span className="text-xs text-white/30 w-5 text-right">{i + 1}</span>
                  <input
                    value={name}
                    onChange={e => setRotDraft(d => d.map((x, j) => j === i ? e.target.value : x))}
                    className="flex-1 bg-transparent text-sm text-white focus:outline-none"
                    placeholder="e.g. Push"
                  />
                  {i === rotTodayIdx ? (
                    <span className="text-xs text-green-400 font-medium">TODAY</span>
                  ) : (
                    <button
                      onClick={() => setRotTodayIdx(i)}
                      className="text-xs text-white/40 whitespace-nowrap active:opacity-60"
                    >
                      Today →
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (i === 0) return
                      setRotDraft(d => { const n = [...d]; [n[i-1], n[i]] = [n[i], n[i-1]]; return n })
                      if (rotTodayIdx === i) setRotTodayIdx(i - 1)
                      else if (rotTodayIdx === i - 1) setRotTodayIdx(i)
                    }}
                    className="text-white/30 active:opacity-60 w-6 text-center"
                  >↑</button>
                  <button
                    onClick={() => {
                      if (i >= rotDraft.length - 1) return
                      setRotDraft(d => { const n = [...d]; [n[i+1], n[i]] = [n[i], n[i+1]]; return n })
                      if (rotTodayIdx === i) setRotTodayIdx(i + 1)
                      else if (rotTodayIdx === i + 1) setRotTodayIdx(i)
                    }}
                    className="text-white/30 active:opacity-60 w-6 text-center"
                  >↓</button>
                  <button
                    onClick={() => {
                      if (rotDraft.length <= 1) return
                      setRotDraft(d => d.filter((_, j) => j !== i))
                      if (rotTodayIdx >= rotDraft.length - 1) setRotTodayIdx(rotDraft.length - 2)
                      else if (i < rotTodayIdx) setRotTodayIdx(t => t - 1)
                    }}
                    className="text-red-400/60 active:opacity-60 w-6 text-center"
                  >×</button>
                </div>
              ))}
            </div>

            <button
              onClick={() => setRotDraft(d => [...d, 'New day'])}
              className="w-full rounded-xl border border-dashed border-white/20 py-3 text-sm text-white/40 active:opacity-60 mb-4"
            >
              + Add day
            </button>

            <div className="flex gap-3">
              <button onClick={() => setShowRotation(false)}
                className="flex-1 rounded-xl bg-white/8 border border-white/10 py-3 text-sm active:opacity-70">
                Cancel
              </button>
              <button onClick={saveRotation}
                className="flex-1 rounded-xl bg-white text-black font-bold py-3 text-sm active:opacity-70">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settings Modal ──────────────────────────────────────────── */}
      {showSettings && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowSettings(false) }}
        >
          <div className="w-full rounded-t-3xl bg-[#111] border-t border-white/10 px-5 pt-5 pb-10 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-base font-bold">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-white/40 text-2xl leading-none">×</button>
            </div>

            <div className="space-y-6">
              {/* Units */}
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Weight unit</label>
                <div className="flex gap-2">
                  {(['lbs', 'kg'] as const).map(u => (
                    <button key={u} onClick={() => setSettingsUnits(u)}
                      className={`rounded-full px-5 py-2 text-sm font-medium border ${settingsUnits === u ? 'bg-white text-black border-transparent' : 'border-white/15 text-white/50'}`}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upgrade at reps */}
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Upgrade at reps</label>
                <input
                  type="number" inputMode="numeric" placeholder="12" value={settingsUpgradeAt === 0 ? '' : settingsUpgradeAt}
                  onFocus={e => e.target.select()} onChange={e => { const raw = e.target.value; setSettingsUpgradeAt(raw === '' ? 0 : (parseInt(raw) ?? 0)) }}
                  className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none"
                />
                <p className="text-xs text-white/30 mt-1">Hit this rep count 2 sessions in a row → increase weight</p>

                <button
                  onClick={fetchCoachReps}
                  disabled={coachRepLoading}
                  className="mt-2 w-full rounded-xl py-2.5 text-sm font-semibold text-black disabled:opacity-50 active:scale-[0.98] transition-transform"
                  style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55),0 2px 8px rgba(0,0,0,0.35)' }}
                >
                  {coachRepLoading ? 'Asking coach…' : 'Let coach decide'}
                </button>

                {coachRepRec && (
                  <p className="text-xs text-white/30 mt-1 leading-relaxed">{coachRepRec.reason}</p>
                )}
              </div>

              {/* Gyms */}
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Gyms</label>
                <div className="space-y-2 mb-2">
                  {settingsGyms.map((g, i) => (
                    <div key={g.id} className="flex gap-2">
                      <input
                        value={g.name}
                        onChange={e => setSettingsGyms(gs => gs.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (settingsGyms.length <= 1) return
                          setSettingsGyms(gs => gs.filter((_, j) => j !== i))
                        }}
                        className="rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-white/40 active:opacity-70"
                      >×</button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setSettingsGyms(gs => [...gs, { id: 'g_' + Date.now(), name: 'New Gym' }])}
                  className="text-xs text-white/40 underline active:opacity-60"
                >
                  + Add gym
                </button>
              </div>

              {/* Data */}
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-3">Data</label>
                <div className="flex gap-2">
                  <button
                    onClick={handleExport}
                    className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm font-medium text-white active:opacity-70"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={() => importRef.current?.click()}
                    className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm font-medium text-white active:opacity-70"
                  >
                    Import JSON
                  </button>
                  <button
                    onClick={handleReset}
                    className="flex-1 rounded-xl border border-red-500/40 px-4 py-3 text-sm font-medium text-red-400 active:opacity-70"
                  >
                    Reset all
                  </button>
                </div>
                <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              </div>
            </div>

            <button
              onClick={saveSettings}
              disabled={saveConfig.isPending}
              className="w-full mt-8 rounded-xl bg-white text-black font-bold py-4 text-base active:opacity-70 disabled:opacity-50"
            >
              Save Settings
            </button>
          </div>
        </div>
      )}
      </>,
      document.body
    )}
    </>
  )
}
