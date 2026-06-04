'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGymConfig, useGymExercises, useAllGymLogs, useBodyWeights, useProgressPhotos } from '@/features/gym/queries'
import { useHealthProfile, useWhoopData } from '@/features/health/queries'
import {
  useSaveGymConfig,
  useCreateExercise, useUpdateExercise, useDeleteExercise,
  useLogSet, useDeleteLog,
  useLogBodyWeight, useUploadPhoto, useDeletePhoto,
} from '@/features/gym/mutations'
import type { GymConfig, GymExercise, GymLog, BodyWeight, Prescription, ProgressPhoto } from '@/features/gym/types'

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

  const pts = entries.map((e, i) => ({
    x: (i / (entries.length - 1)) * W,
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
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
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
  dayId: string
  bodyweight: boolean
  repMin: number
  repMax: number
  step: number
}

const EMPTY_EX_MODAL: ExModalState = {
  open: false, mode: 'add', name: '', gymId: 'g_default', dayId: '',
  bodyweight: false, repMin: 8, repMax: 12, step: 2.5,
}

// ─── main ────────────────────────────────────────────────────────────────────

interface Props {
  today: string
  initialConfig: GymConfig
  initialExercises: GymExercise[]
  initialBodyWeights: BodyWeight[]
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
  const { data: photos = [] } = useProgressPhotos()
  const { data: healthProfile } = useHealthProfile()
  const { data: whoopToday } = useWhoopData(today, true, null)

  const saveConfig = useSaveGymConfig()
  const createEx = useCreateExercise()
  const updateEx = useUpdateExercise()
  const deleteEx = useDeleteExercise()
  const logSet = useLogSet()
  const deleteLog = useDeleteLog()
  const logBw = useLogBodyWeight()
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
      if (ex && config.days.find(d => d.id === ex.day_id)) {
        setFilterDay(ex.day_id)
      }
      return
    }

    // Advance from the last logged day
    const mostRecent = allLogs.reduce((a, b) => a.logged_at > b.logged_at ? a : b)
    const lastEx = exercises.find(e => e.id === mostRecent.exercise_id)
    if (!lastEx) return

    const lastDay = config.days.find(d => d.id === lastEx.day_id)
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

  // Modals
  const [exModal, setExModal] = useState<ExModalState>(EMPTY_EX_MODAL)
  const [showSettings, setShowSettings] = useState(false)
  const [showRotation, setShowRotation] = useState(false)
  const [rotDraft, setRotDraft] = useState<string[]>([])
  const [rotTodayIdx, setRotTodayIdx] = useState(0)

  // Body weight input
  const [bwInput, setBwInput] = useState<string>('')
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
    const dayOk = !filterDay || ex.day_id === filterDay
    return gymOk && dayOk
  }), [exercises, filterGym, filterDay])

  const currentEx = useMemo(() =>
    filteredExercises.find(e => e.id === currentExId) ?? filteredExercises[0] ?? null,
    [filteredExercises, currentExId]
  )

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

  const est1RM = useMemo(() => {
    if (!exLogs.length || currentEx?.bodyweight) return null
    const last = exLogs[exLogs.length - 1]
    return compute1RM(last.weight, last.reps)
  }, [exLogs, currentEx])

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
    logSet.mutate({ exercise_id: currentEx.id, weight: w, reps })
  }

  function openAddEx() {
    setCoachStepRec(null)
    setExModal({
      ...EMPTY_EX_MODAL,
      open: true, mode: 'add',
      gymId: filterGym,
      dayId: filterDay,
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
      dayId: currentEx.day_id,
      bodyweight: currentEx.bodyweight,
      repMin: currentEx.rep_min,
      repMax: currentEx.rep_max,
      step: currentEx.step,
    })
  }

  function saveEx() {
    const { mode, id, name, gymId, dayId, bodyweight, repMin, repMax, step } = exModal
    if (!name.trim() || !gymId || !dayId) return
    if (mode === 'edit' && id) {
      updateEx.mutate({ id, name: name.trim(), gym_id: gymId, day_id: dayId, bodyweight, start_weight: 0, rep_min: repMin, rep_max: repMax, step })
    } else {
      createEx.mutate(
        { name: name.trim(), gym_id: gymId, day_id: dayId, bodyweight, start_weight: 0, rep_min: repMin, rep_max: repMax, step, order_index: exercises.length },
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
    const verdict = Math.abs(weeklyRate) < 0.25 ? 'Maintaining' : weeklyRate < 0 ? 'Cutting' : 'Gaining'
    // Deurenberg body fat % — only when profile has height/age/sex
    let bf: { fatPct: number; leanLbs: number; fatLbs: number } | null = null
    if (healthProfile?.height_cm && healthProfile.age && healthProfile.sex) {
      const heightM = healthProfile.height_cm / 100
      const weightKg = currentWeight * 0.453592
      const bmi = weightKg / (heightM * heightM)
      const sexFactor = healthProfile.sex === 'm' ? 1 : healthProfile.sex === 'f' ? 0 : 0.5
      const fatPct = Math.max(5, Math.min(50, (1.20 * bmi) + (0.23 * healthProfile.age) - (10.8 * sexFactor) - 5.4))
      bf = { fatPct, leanLbs: currentWeight * (1 - fatPct / 100), fatLbs: currentWeight * (fatPct / 100) }
    }
    return { weeklyRate, verdict, bf }
  })()
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
    <div className="min-h-screen bg-black text-white pb-28">
      {/* Day Pill */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-2 bg-black/80 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          <button
            onClick={openRotModal}
            className="flex items-center gap-2 rounded-full bg-white/8 border border-white/10 px-4 py-2 active:opacity-70"
          >
            <span className="text-xs text-white/50 font-mono tracking-widest">{todayDateLabel()}</span>
            <span className={`text-xs font-bold tracking-widest`} style={{ color: isRest(split.name) ? '#7DD3FC' : '#4ade80' }}>
              {splitLabel(split.name)}
            </span>
          </button>
          <button
            onClick={openSettings}
            className="w-9 h-9 rounded-full bg-white/8 border border-white/10 flex items-center justify-center text-white/50 active:opacity-70"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 10a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v.823a5.002 5.002 0 013.177 3.177h.823a.75.75 0 010 1.5h-.823a5.002 5.002 0 01-3.177 3.177v.823a.75.75 0 01-1.5 0v-.823a5.002 5.002 0 01-3.177-3.177H2.25a.75.75 0 010-1.5h.823A5.002 5.002 0 016.25 2.573V1.75A.75.75 0 018 1z" />
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
        <section className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
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
            <div className="px-2">
              <WtChart entries={bodyWeights} units={config.units} />
            </div>
          )}

          {compEstimate && (
            <div className="mx-5 mb-4 rounded-xl bg-white/[0.04] border border-white/[0.07] px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white/70">{compEstimate.verdict}</span>
                <span className="text-[10px] text-white/30">
                  {compEstimate.weeklyRate > 0 ? '+' : ''}{compEstimate.weeklyRate.toFixed(2)} lbs/wk
                </span>
              </div>
              {compEstimate.bf && (
                <>
                  <div className="flex rounded-full overflow-hidden h-2">
                    <div className="bg-green-400/70" style={{ width: `${(100 - compEstimate.bf.fatPct).toFixed(1)}%` }} />
                    <div className="bg-white/20" style={{ width: `${compEstimate.bf.fatPct.toFixed(1)}%` }} />
                  </div>
                  <p className="text-[10px] text-white/30">
                    ~{compEstimate.bf.leanLbs.toFixed(1)} lbs lean · ~{compEstimate.bf.fatLbs.toFixed(1)} lbs fat · ~{compEstimate.bf.fatPct.toFixed(1)}% BF (est.)
                  </p>
                </>
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
        </section>

        {/* ── Progress Photos Card ──────────────────────────────────── */}
        <button
          onClick={() => { setShowPhotos(true); setPhotoMode('grid') }}
          className="w-full rounded-2xl bg-[#111113] border px-5 py-[18px] flex items-center justify-between"
          style={{ borderColor: 'rgba(110,231,183,0.10)' }}
        >
          <div className="text-left">
            <p className="text-xs text-white/40 uppercase tracking-[0.20em] font-semibold mb-1">Progress Photos</p>
            <p className="text-sm font-medium">{photos.length} photo{photos.length !== 1 ? 's' : ''}</p>
          </div>
          <span style={{ color: '#6ee7b7', fontSize: 20 }}>→</span>
        </button>

        {/* ── Coach ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl overflow-hidden border border-white/8">
          <div className="flex">
            <button
              onClick={() => streamCoach('angel')}
              disabled={coachStreaming}
              className={`flex-1 flex flex-col items-center justify-center py-4 gap-1 transition-colors active:opacity-70 disabled:opacity-50 ${
                coachMode === 'angel' ? 'bg-emerald-950/60' : 'bg-white/5'
              }`}
            >
              <span className="text-2xl">😇</span>
              <span className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">
                {coachStreaming && coachMode === 'angel' ? 'Talking…' : 'Hype me up'}
              </span>
            </button>
            <div className="w-px bg-white/8" />
            <button
              onClick={() => streamCoach('devil')}
              disabled={coachStreaming}
              className={`flex-1 flex flex-col items-center justify-center py-4 gap-1 transition-colors active:opacity-70 disabled:opacity-50 ${
                coachMode === 'devil' ? 'bg-red-950/60' : 'bg-white/5'
              }`}
            >
              <span className="text-2xl">😈</span>
              <span className="text-xs font-semibold tracking-widest text-red-400 uppercase">
                {coachStreaming && coachMode === 'devil' ? 'Talking…' : 'Yell at me'}
              </span>
            </button>
          </div>
          {coachText && (
            <div className={`px-5 py-4 border-t border-white/8 ${
              coachMode === 'devil' ? 'bg-red-950/30' : 'bg-emerald-950/30'
            }`}>
              <p className="text-sm leading-relaxed text-white/90">{coachText}</p>
            </div>
          )}
        </section>

        {/* ── Whoop Today ───────────────────────────────────────────── */}
        {whoopToday && (whoopToday.cycle?.strain != null || whoopToday.recovery?.score != null) && (
          <section className="rounded-2xl bg-white/5 border border-white/8 px-5 py-4">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 mb-3">Whoop Today</p>
            <div className="flex gap-6">
              {whoopToday.recovery?.score != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-white/30">Recovery</p>
                  <p className={`text-2xl font-bold ${whoopToday.recovery.score >= 67 ? 'text-green-400' : whoopToday.recovery.score >= 34 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {whoopToday.recovery.score}%
                  </p>
                </div>
              )}
              {whoopToday.cycle?.strain != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-white/30">Strain</p>
                  <p className="text-2xl font-bold text-white">{whoopToday.cycle.strain.toFixed(1)}</p>
                  <p className="text-[10px] text-white/20">/21</p>
                </div>
              )}
              {whoopToday.cycle?.kilojoule != null && (
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-white/30">Cals Burned</p>
                  <p className="text-2xl font-bold text-white">{Math.round(whoopToday.cycle.kilojoule * 0.239).toLocaleString()}</p>
                  <p className="text-[10px] text-white/20">kcal</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── PO Coach ──────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <p className="text-xs text-white/40 uppercase tracking-widest mb-4">Progressive Overload Coach</p>

            {/* Gym filter */}
            <div className="flex items-center gap-3 mb-3">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 w-10 flex-shrink-0">GYM</span>
              <div className="flex-1 flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1">
                {config.gyms.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setFilterGym(g.id)}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      filterGym === g.id
                        ? 'bg-white text-black shadow-sm'
                        : 'text-white/40'
                    }`}
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Day filter */}
            <div className="flex items-center gap-3 mb-4">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 w-10 flex-shrink-0">DAY</span>
              <div className="flex-1 flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1">
                {config.days.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setFilterDay(d.id)}
                    className={`flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                      filterDay === d.id
                        ? 'bg-white text-black shadow-sm'
                        : 'text-white/40'
                    }`}
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Exercise select */}
            <div className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <select
                  value={currentEx?.id ?? ''}
                  onChange={e => selectEx(e.target.value)}
                  className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white appearance-none focus:outline-none pr-8"
                >
                  {filteredExercises.length === 0 && (
                    <option value="">No exercises — add one</option>
                  )}
                  {filteredExercises.map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.name}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/40" width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                  <path d="M6 8L1 3h10z" />
                </svg>
              </div>
              <button
                onClick={openEditEx}
                disabled={!currentEx}
                className="rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white/60 active:opacity-70 disabled:opacity-30"
                title="Edit exercise"
              >
                ✎
              </button>
              <button
                onClick={openAddEx}
                className="rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white/60 active:opacity-70"
                title="Add exercise"
              >
                +
              </button>
            </div>

            {currentEx && (
              <>
                {/* Last set banner */}
                {lastLog && (
                  <div className="rounded-xl bg-white/5 border border-white/8 px-4 py-3 mb-4 flex items-center gap-3">
                    <span className="text-xs text-white/40 uppercase tracking-widest font-bold">Last time</span>
                    <span className="text-sm font-bold flex-1">
                      {currentEx.bodyweight
                        ? `${lastLog.reps} reps`
                        : `${lastLog.weight}${config.units} × ${lastLog.reps}`
                      }
                    </span>
                    <span className="text-xs text-white/30 font-mono">{lastLogAgo}</span>
                  </div>
                )}

                {/* Weight stepper */}
                {!currentEx.bodyweight && (
                  <div className="relative flex items-center justify-center mb-3" style={{ height: 56 }}>
                    <button
                      onClick={() => setWeightInput(w => {
                        const next = Math.max(0, (parseFloat(w) || 0) - currentEx.step)
                        return +next.toFixed(4) === 0 ? '0' : String(+next.toFixed(4))
                      })}
                      className="absolute left-0 w-11 h-11 rounded-xl bg-white/8 border border-white/10 text-lg font-light active:opacity-70 flex items-center justify-center"
                    >−</button>
                    <div className="text-center">
                      <input
                        type="number"
                        inputMode="decimal"
                        step={currentEx.step}
                        value={weightInput}
                        onFocus={e => e.target.select()}
                        onChange={e => setWeightInput(e.target.value)}
                        className="w-28 text-center text-2xl font-bold bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <p className="text-xs text-white/30 -mt-1">{config.units}</p>
                    </div>
                    <button
                      onClick={() => setWeightInput(w => String(+((parseFloat(w) || 0) + currentEx.step).toFixed(4)))}
                      className="absolute right-0 w-11 h-11 rounded-xl bg-white/8 border border-white/10 text-lg font-light active:opacity-70 flex items-center justify-center"
                    >+</button>
                  </div>
                )}

                {/* Reps slider */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs text-white/40 uppercase tracking-widest font-bold">Reps</label>
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
                      background: `linear-gradient(to right, #fff ${((selectedReps - 3) / (20 - 3)) * 100}%, rgba(255,255,255,0.15) 0%)`,
                      WebkitAppearance: 'none',
                    }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-white/20">3</span>
                    <span className="text-xs text-white/20">20</span>
                  </div>
                </div>

                {/* Log Set button */}
                <button
                  onClick={handleLogSet}
                  disabled={logSet.isPending}
                  className="w-full rounded-xl bg-green-400 text-black font-bold py-4 text-base active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  Log Set
                </button>

                {/* Prescription card */}
                {rx && (
                  <div className={`mt-4 rounded-xl border px-4 py-3 ${rxColors[rx.action]}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">{rxIcons[rx.action]}</span>
                      <span className="text-sm font-bold">{rx.action}</span>
                    </div>
                    <p className="text-xs opacity-80">{rx.reason}</p>
                    {rx.nextWeight != null && (
                      <p className="text-xs mt-1 opacity-70">Target: {rx.nextWeight} {config.units}</p>
                    )}
                  </div>
                )}

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-3 text-center">
                    <p className="text-xs text-white/30 mb-1">{currentEx.bodyweight ? 'Best reps' : 'Est 1RM'}</p>
                    <p className="text-base font-bold tabular-nums">
                      {est1RM != null ? Math.round(est1RM) : (currentEx.bodyweight && bestSet ? bestSet.reps : '—')}
                    </p>
                    {est1RM != null && <p className="text-xs text-white/30">{config.units}</p>}
                  </div>
                  <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-3 text-center">
                    <p className="text-xs text-white/30 mb-1">Best set</p>
                    <p className="text-base font-bold tabular-nums">
                      {bestSet
                        ? (currentEx.bodyweight ? `${bestSet.reps}` : `${bestSet.weight}×${bestSet.reps}`)
                        : '—'
                      }
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-3 text-center">
                    <p className="text-xs text-white/30 mb-1">Sessions</p>
                    <p className="text-base font-bold tabular-nums">{exLogs.length}</p>
                  </div>
                </div>

                {/* Sparkline */}
                {exLogs.length >= 2 && (
                  <div className="mt-4 rounded-xl bg-white/5 border border-white/8 overflow-hidden">
                    <p className="text-xs text-white/30 uppercase tracking-widest px-3 pt-3 pb-1">Trend (last 15 sets)</p>
                    <PoSparkline logs={exLogs} bodyweight={currentEx.bodyweight} />
                  </div>
                )}

              </>
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
        </section>

        {/* ── Today's Workout ───────────────────────────────────── */}
        {todayAllLogs.length > 0 && (
          <section>
            <div className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
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
                  onClick={() => setTodayDone(d => !d)}
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

        {/* ── Past Workouts ─────────────────────────────────────────── */}
        {pastDates.length > 0 && (
          <section>
            <button
              onClick={() => setPastExpanded(e => !e)}
              className="w-full rounded-2xl bg-white/5 border border-white/8 px-5 py-4 flex items-center justify-between active:opacity-70"
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
                    <div key={date} className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
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
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Day</label>
                <div className="flex gap-2 flex-wrap">
                  {config.days.map(d => (
                    <button key={d.id} onClick={() => setExModal(m => ({ ...m, dayId: d.id }))}
                      className={`rounded-full px-3 py-1.5 text-xs border ${exModal.dayId === d.id ? 'bg-green-400 text-black border-transparent' : 'border-white/15 text-white/50'}`}>
                      {d.name}
                    </button>
                  ))}
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
                disabled={!exModal.name.trim() || !exModal.gymId || !exModal.dayId}
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
    </div>
  )
}
