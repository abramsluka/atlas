'use client'

import { useState, useRef, useCallback, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useGymConfig, useGymExercises, useAllGymLogs, useBodyWeights } from '@/features/gym/queries'
import {
  useSaveGymConfig,
  useCreateExercise, useUpdateExercise, useDeleteExercise,
  useLogSet, useDeleteLog,
  useLogBodyWeight,
} from '@/features/gym/mutations'
import type { GymConfig, GymExercise, GymLog, BodyWeight, Prescription } from '@/features/gym/types'

// ─── helpers ────────────────────────────────────────────────────────────────

function toPSTDate(): Date {
  const now = new Date()
  return new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
}

function todayKey(): string {
  const d = toPSTDate()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function logDatePST(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

const DOWS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function todayDateLabel(): string {
  const d = toPSTDate()
  return DOWS[d.getDay()] + ', ' + MONS[d.getMonth()] + ' ' + d.getDate()
}

function computeSplit(config: GymConfig): { name: string; index: number } {
  const rot = config.split_rotation
  if (!rot.length) return { name: '—', index: 0 }
  if (!config.split_anchor) return { name: rot[0], index: 0 }
  try {
    const a = new Date(config.split_anchor.date)
    const t = new Date()
    a.setHours(0, 0, 0, 0)
    t.setHours(0, 0, 0, 0)
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

function getRx(logs: GymLog[], repMin: number, repMax: number, upgradeAtReps: number): Prescription | null {
  if (!logs.length) return null
  const upgradeAt = Math.min(upgradeAtReps, repMax)
  const last = logs[logs.length - 1]

  // Count consecutive sessions at/above upgradeAt (by date, not individual sets)
  const sessionDates = [...new Set(logs.map(l => logDatePST(l.logged_at)))].sort()
  const sessionMaxReps: Record<string, number> = {}
  logs.forEach(l => {
    const dk = logDatePST(l.logged_at)
    sessionMaxReps[dk] = Math.max(sessionMaxReps[dk] ?? 0, l.reps)
  })

  let upgradeStreak = 0
  for (let i = sessionDates.length - 1; i >= 0; i--) {
    if (sessionMaxReps[sessionDates[i]] >= upgradeAt) upgradeStreak++
    else break
  }

  // Stuck: last 3 unique sessions all below repMin
  const recentSessions = sessionDates.slice(-3)
  const stuck = recentSessions.length >= 3 && recentSessions.every(dk => sessionMaxReps[dk] < repMin)

  const units = '' // units shown in GymClient, not here

  if (stuck) {
    return {
      action: 'DELOAD',
      reason: 'Stuck for 3+ sessions — deload 10%',
      nextWeight: last.weight > 0 ? Math.round((last.weight * 0.9) / 2.5) * 2.5 : undefined,
    }
  }
  if (upgradeStreak >= 2) {
    return {
      action: 'INCREASE',
      reason: `Hit ${upgradeAt}+ reps ${upgradeStreak} sessions in a row`,
    }
  }
  if (last.reps >= repMin) {
    return { action: 'HOLD', reason: 'In target range — stay here' }
  }
  return { action: 'REPEAT', reason: `${last.reps} reps — build up to ${repMin}` }
}

// SVG sparkline for last N sessions (by date)
function PoSparkline({ logs, repMax }: { logs: GymLog[]; repMax: number }) {
  const sessions = useMemo(() => {
    const byDate: Record<string, GymLog[]> = {}
    logs.forEach(l => {
      const dk = logDatePST(l.logged_at)
      if (!byDate[dk]) byDate[dk] = []
      byDate[dk].push(l)
    })
    return Object.entries(byDate)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([dk, ls]) => ({
        dk,
        maxWeight: Math.max(...ls.map(l => l.weight)),
        maxReps: Math.max(...ls.map(l => l.reps)),
      }))
  }, [logs])

  if (sessions.length < 2) return (
    <div className="flex items-center justify-center h-[60px] text-xs text-white/30">
      Log 2+ sessions to see chart
    </div>
  )

  const W = 280, H = 60
  const weights = sessions.map(s => s.maxWeight)
  const minW = Math.min(...weights)
  const maxW = Math.max(...weights)
  const range = maxW - minW || 1

  const pts = sessions.map((s, i) => ({
    x: (i / (sessions.length - 1)) * W,
    y: H - 8 - ((s.maxWeight - minW) / range) * (H - 16),
  }))

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1].x + pts[i].x) / 2
    d += ` C ${cx.toFixed(1)} ${pts[i-1].y.toFixed(1)}, ${cx.toFixed(1)} ${pts[i].y.toFixed(1)}, ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`
  }
  const fill = d + ` L ${pts[pts.length-1].x} ${H} L ${pts[0].x} ${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 60 }}>
      <defs>
        <linearGradient id="spk-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ade80" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#spk-fill)" />
      <path d={d} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#4ade80" />
      ))}
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

  // 7-day avg line
  const avg7 = entries.length >= 7
    ? entries.slice(-7).reduce((s, e) => s + e.weight, 0) / 7
    : null
  const avgY = avg7 != null
    ? H - 10 - ((avg7 - padded.min) / totalRange) * (H - 20)
    : null

  const lastPt = pts[pts.length - 1]

  return (
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
      {avgY != null && (
        <line x1="0" y1={avgY} x2={W} y2={avgY} stroke="#4ade80" strokeWidth="1" strokeDasharray="4 3" opacity="0.5" />
      )}
      <circle cx={lastPt.x} cy={lastPt.y} r="4" fill="#4ade80" />
    </svg>
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
  startWeight: number
  repMin: number
  repMax: number
  step: number
}

const EMPTY_EX_MODAL: ExModalState = {
  open: false, mode: 'add', name: '', gymId: 'g_default', dayId: '',
  bodyweight: false, startWeight: 20, repMin: 6, repMax: 8, step: 2.5,
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

  const saveConfig = useSaveGymConfig()
  const createEx = useCreateExercise()
  const updateEx = useUpdateExercise()
  const deleteEx = useDeleteExercise()
  const logSet = useLogSet()
  const deleteLog = useDeleteLog()
  const logBw = useLogBodyWeight()

  // Filter state
  const [filterGym, setFilterGym] = useState<string>(config.gyms[0]?.id ?? 'g_default')
  const [filterDay, setFilterDay] = useState<string>(() => {
    const split = computeSplit(config)
    const match = config.days.find(d => d.name.toLowerCase() === split.name.toLowerCase())
    return match?.id ?? config.days[0]?.id ?? ''
  })
  const [currentExId, setCurrentExId] = useState<string | null>(null)

  // Weight stepper
  const [weightInput, setWeightInput] = useState<number>(0)
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

  // Settings local state
  const [settingsGyms, setSettingsGyms] = useState(config.gyms)
  const [settingsDays, setSettingsDays] = useState(config.days)
  const [settingsUnits, setSettingsUnits] = useState(config.units)
  const [settingsUpgradeAt, setSettingsUpgradeAt] = useState(config.upgrade_at_reps)

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
  const repEnd = Math.min(Math.max(repMax + 2, repMin + 5), repMin + 15)

  const rx = useMemo(() => {
    if (!currentEx) return null
    return getRx(exLogs, currentEx.rep_min, currentEx.rep_max, config.upgrade_at_reps)
  }, [exLogs, currentEx, config.upgrade_at_reps])

  const est1RM = useMemo(() => {
    if (!exLogs.length || currentEx?.bodyweight) return null
    const last = exLogs[exLogs.length - 1]
    return compute1RM(last.weight, last.reps)
  }, [exLogs, currentEx])

  const sessionDates = useMemo(() => {
    const dates = new Set(exLogs.map(l => logDatePST(l.logged_at)))
    return [...dates].sort()
  }, [exLogs])

  // Today's sets for this exercise
  const todayExLogs = useMemo(() =>
    exLogs.filter(l => logDatePST(l.logged_at) === today),
    [exLogs, today]
  )

  // ── actions ──────────────────────────────────────────────────────────────

  function selectEx(id: string) {
    const ex = exercises.find(e => e.id === id)
    if (!ex) return
    setCurrentExId(id)
    const logs = allLogs.filter(l => l.exercise_id === id).sort((a, b) => a.logged_at.localeCompare(b.logged_at))
    const lastLog = logs[logs.length - 1]
    setWeightInput(lastLog?.weight ?? ex.start_weight ?? 0)
    setSelectedReps(ex.rep_max)
  }

  function handleLogSet() {
    if (!currentEx) return
    const reps = selectedReps
    const w = currentEx.bodyweight ? 0 : weightInput
    logSet.mutate({ exercise_id: currentEx.id, weight: w, reps })
  }

  function openAddEx() {
    setExModal({
      ...EMPTY_EX_MODAL,
      open: true, mode: 'add',
      gymId: filterGym,
      dayId: filterDay,
      repMax: 8,
    })
  }

  function openEditEx() {
    if (!currentEx) return
    setExModal({
      open: true, mode: 'edit',
      id: currentEx.id,
      name: currentEx.name,
      gymId: currentEx.gym_id,
      dayId: currentEx.day_id,
      bodyweight: currentEx.bodyweight,
      startWeight: currentEx.start_weight,
      repMin: currentEx.rep_min,
      repMax: currentEx.rep_max,
      step: currentEx.step,
    })
  }

  function saveEx() {
    const { mode, id, name, gymId, dayId, bodyweight, startWeight, repMin, repMax, step } = exModal
    if (!name.trim() || !gymId || !dayId) return
    if (mode === 'edit' && id) {
      updateEx.mutate({ id, name: name.trim(), gym_id: gymId, day_id: dayId, bodyweight, start_weight: startWeight, rep_min: repMin, rep_max: repMax, step })
    } else {
      createEx.mutate(
        { name: name.trim(), gym_id: gymId, day_id: dayId, bodyweight, start_weight: startWeight, rep_min: repMin, rep_max: repMax, step, order_index: exercises.length },
        { onSuccess: (ex) => { setCurrentExId(ex.id); setWeightInput(ex.start_weight) } }
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
    saveConfig.mutate({
      ...config,
      split_rotation: cleaned,
      split_anchor: { date: today, index: newTodayIdx },
    })
    setShowRotation(false)
  }

  function saveSettings() {
    saveConfig.mutate({
      ...config,
      gyms: settingsGyms,
      days: settingsDays,
      units: settingsUnits,
      upgrade_at_reps: settingsUpgradeAt,
    })
    setShowSettings(false)
  }

  function openSettings() {
    setSettingsGyms(config.gyms.map(g => ({ ...g })))
    setSettingsDays(config.days.map(d => ({ ...d })))
    setSettingsUnits(config.units)
    setSettingsUpgradeAt(config.upgrade_at_reps)
    setShowSettings(true)
  }

  // ── render ────────────────────────────────────────────────────────────────

  const rxColors: Record<string, string> = {
    INCREASE: 'text-green-400 border-green-400/30 bg-green-400/10',
    HOLD: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10',
    REPEAT: 'text-white/60 border-white/10 bg-white/5',
    DELOAD: 'text-red-400 border-red-400/30 bg-red-400/10',
  }
  const rxIcons: Record<string, string> = {
    INCREASE: '↑', HOLD: '→', REPEAT: '↺', DELOAD: '↓',
  }

  const bwDelta = bodyWeights.length >= 2
    ? bodyWeights[bodyWeights.length - 1].weight - bodyWeights[0].weight
    : null

  // Today's full workout summary
  const todayAllLogs = allLogs.filter(l => logDatePST(l.logged_at) === today)
  const todayExIds = [...new Set(todayAllLogs.map(l => l.exercise_id))]
  const todayVolume = todayAllLogs.reduce((s, l) => s + l.weight * l.reps, 0)

  // Past workouts (for history)
  const pastDates = [...new Set(
    allLogs.filter(l => logDatePST(l.logged_at) !== today).map(l => logDatePST(l.logged_at))
  )].sort((a, b) => b.localeCompare(a)).slice(0, 10)

  return (
    <div className="min-h-screen bg-black text-white pb-28">
      {/* Day Pill */}
      <div className="sticky top-0 z-10 px-4 pt-4 pb-2 bg-black/80 backdrop-blur-sm flex items-center justify-between">
        <button
          onClick={openRotModal}
          className="flex items-center gap-2 rounded-full bg-white/8 border border-white/10 px-4 py-2 active:opacity-70"
        >
          <span className="text-xs text-white/50 font-mono tracking-widest">{todayDateLabel()}</span>
          <span className={`text-xs font-bold tracking-widest ${isRest(split.name) ? 'text-white/40' : 'text-green-400'}`}>
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

      <div className="px-4 space-y-4 pt-2">

        {/* ── Body Weight Tracker ────────────────────────────────────── */}
        <section className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <div className="flex items-end justify-between mb-1">
              <div>
                <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Body Weight</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold tabular-nums">
                    {bodyWeights.length ? bodyWeights[bodyWeights.length - 1].weight.toFixed(1) : '—'}
                  </span>
                  <span className="text-sm text-white/40">{config.units}</span>
                  {bwDelta != null && bodyWeights.length >= 2 && (
                    <span className={`text-sm font-medium ${bwDelta < 0 ? 'text-green-400' : bwDelta > 0 ? 'text-red-400' : 'text-white/40'}`}>
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
                    step="0.1"
                    value={bwInput}
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

        {/* ── PO Coach ──────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <p className="text-xs text-white/40 uppercase tracking-widest mb-4">Progressive Overload Coach</p>

            {/* Gym filter chips */}
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1 scrollbar-none">
              {config.gyms.map(g => (
                <button
                  key={g.id}
                  onClick={() => setFilterGym(g.id)}
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    filterGym === g.id
                      ? 'bg-white text-black border-transparent'
                      : 'bg-transparent text-white/50 border-white/15'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>

            {/* Day filter chips */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1 scrollbar-none">
              {config.days.map(d => (
                <button
                  key={d.id}
                  onClick={() => setFilterDay(d.id)}
                  className={`flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                    filterDay === d.id
                      ? 'bg-green-400 text-black border-transparent'
                      : 'bg-transparent text-white/50 border-white/15'
                  }`}
                >
                  {d.name}
                </button>
              ))}
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
                {todayExLogs.length > 0 && (
                  <div className="rounded-xl bg-white/5 border border-white/8 px-4 py-3 mb-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-white/40 mb-0.5">Last set today</p>
                      <p className="text-sm font-medium">
                        {currentEx.bodyweight
                          ? `${todayExLogs[todayExLogs.length - 1].reps} reps`
                          : `${todayExLogs[todayExLogs.length - 1].weight} ${config.units} × ${todayExLogs[todayExLogs.length - 1].reps}`
                        }
                      </p>
                    </div>
                    <span className="text-xs text-white/30">{todayExLogs.length} set{todayExLogs.length !== 1 ? 's' : ''}</span>
                  </div>
                )}

                {/* Weight stepper */}
                {!currentEx.bodyweight && (
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      onClick={() => setWeightInput(w => Math.max(0, +(w - currentEx.step).toFixed(2)))}
                      className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 text-lg font-light active:opacity-70 flex items-center justify-center"
                    >−</button>
                    <div className="flex-1 text-center">
                      <input
                        type="number"
                        step={currentEx.step}
                        value={weightInput}
                        onChange={e => setWeightInput(parseFloat(e.target.value) || 0)}
                        className="w-full text-center text-2xl font-bold bg-transparent focus:outline-none"
                      />
                      <p className="text-xs text-white/30 -mt-1">{config.units}</p>
                    </div>
                    <button
                      onClick={() => setWeightInput(w => +(w + currentEx.step).toFixed(2))}
                      className="w-11 h-11 rounded-xl bg-white/8 border border-white/10 text-lg font-light active:opacity-70 flex items-center justify-center"
                    >+</button>
                  </div>
                )}

                {/* Rep chips */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {Array.from({ length: repEnd - repMin + 1 }, (_, i) => repMin + i).map(r => (
                    <button
                      key={r}
                      onClick={() => setSelectedReps(r)}
                      className={`rounded-full w-10 h-10 text-sm font-semibold border transition-colors ${
                        selectedReps === r
                          ? 'bg-green-400 text-black border-transparent'
                          : 'bg-white/5 text-white/60 border-white/10'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
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
                    <p className="text-xs text-white/30 mb-1">Est 1RM</p>
                    <p className="text-base font-bold">
                      {est1RM != null ? Math.round(est1RM) : '—'}
                    </p>
                    {est1RM != null && <p className="text-xs text-white/30">{config.units}</p>}
                  </div>
                  <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-3 text-center">
                    <p className="text-xs text-white/30 mb-1">Sessions</p>
                    <p className="text-base font-bold">{sessionDates.length}</p>
                  </div>
                  <div className="rounded-xl bg-white/5 border border-white/8 px-3 py-3 text-center">
                    <p className="text-xs text-white/30 mb-1">Sets today</p>
                    <p className="text-base font-bold">{todayExLogs.length}</p>
                  </div>
                </div>

                {/* Sparkline */}
                {exLogs.length >= 2 && (
                  <div className="mt-4 rounded-xl bg-white/5 border border-white/8 p-3">
                    <p className="text-xs text-white/30 mb-2">Last 14 sessions</p>
                    <PoSparkline logs={exLogs} repMax={repMax} />
                  </div>
                )}

                {/* History rows */}
                {sessionDates.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-white/30 uppercase tracking-widest mb-2">History</p>
                    <div className="space-y-2">
                      {sessionDates.slice().reverse().slice(0, 8).map(dk => {
                        const setsOnDay = exLogs.filter(l => logDatePST(l.logged_at) === dk)
                        const maxW = Math.max(...setsOnDay.map(l => l.weight))
                        const maxR = Math.max(...setsOnDay.map(l => l.reps))
                        const [y, m, d] = dk.split('-').map(Number)
                        const dt = new Date(y, m - 1, d)
                        const label = DOWS[dt.getDay()] + ' ' + MONS[dt.getMonth()] + ' ' + d
                        return (
                          <div key={dk} className="flex items-center justify-between rounded-xl bg-white/5 border border-white/8 px-4 py-3">
                            <span className="text-xs text-white/40 font-mono">{label}</span>
                            <span className="text-sm font-medium">
                              {currentEx.bodyweight
                                ? `${maxR} reps · ${setsOnDay.length} sets`
                                : `${maxW} ${config.units} × ${maxR} · ${setsOnDay.length} sets`
                              }
                            </span>
                          </div>
                        )
                      })}
                    </div>
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

        {/* ── Today's Workout Summary ──────────────────────────────── */}
        {todayAllLogs.length > 0 && (
          <section className="rounded-2xl bg-white/5 border border-white/8 px-5 py-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-white/40 uppercase tracking-widest">Today · {todayDateLabel()}</p>
              <p className="text-xs text-white/30">{todayAllLogs.length} sets · {Math.round(todayVolume).toLocaleString()} {config.units}</p>
            </div>
            <div className="space-y-1">
              {todayExIds.map(exId => {
                const ex = exercises.find(e => e.id === exId)
                const sets = todayAllLogs.filter(l => l.exercise_id === exId)
                const topW = Math.max(...sets.map(l => l.weight))
                const topR = Math.max(...sets.map(l => l.reps))
                return (
                  <div key={exId} className="flex items-center justify-between py-1">
                    <span className="text-sm text-white/70">{ex?.name ?? 'Exercise'}</span>
                    <span className="text-xs text-white/40">
                      {ex?.bodyweight
                        ? `${sets.length} sets · top ${topR}`
                        : `${sets.length} sets · top ${topW}${config.units}`
                      }
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

      </div>

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
                    <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Start weight</label>
                    <input type="number" step="2.5" value={exModal.startWeight}
                      onChange={e => setExModal(m => ({ ...m, startWeight: parseFloat(e.target.value) || 0 }))}
                      className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Step ({config.units})</label>
                    <input type="number" step="1.25" value={exModal.step}
                      onChange={e => setExModal(m => ({ ...m, step: parseFloat(e.target.value) || 2.5 }))}
                      className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Rep min</label>
                  <input type="number" min="1" value={exModal.repMin}
                    onChange={e => setExModal(m => ({ ...m, repMin: parseInt(e.target.value) || 1 }))}
                    className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Rep max</label>
                  <input type="number" min="1" value={exModal.repMax}
                    onChange={e => setExModal(m => ({ ...m, repMax: parseInt(e.target.value) || 1 }))}
                    className="w-full rounded-xl bg-white/8 border border-white/10 px-3 py-3 text-sm text-white focus:outline-none" />
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
                  type="number" min="1" max="20" value={settingsUpgradeAt}
                  onChange={e => setSettingsUpgradeAt(parseInt(e.target.value) || 12)}
                  className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none"
                />
                <p className="text-xs text-white/30 mt-1">Hit this rep count 2 sessions in a row → increase weight</p>
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

              {/* Days */}
              <div>
                <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Training days</label>
                <div className="space-y-2 mb-2">
                  {settingsDays.map((d, i) => (
                    <div key={d.id} className="flex gap-2">
                      <input
                        value={d.name}
                        onChange={e => setSettingsDays(ds => ds.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                        className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none"
                      />
                      <button
                        onClick={() => {
                          if (settingsDays.length <= 1) return
                          setSettingsDays(ds => ds.filter((_, j) => j !== i))
                        }}
                        className="rounded-xl bg-white/5 border border-white/10 px-3 py-3 text-white/40 active:opacity-70"
                      >×</button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setSettingsDays(ds => [...ds, { id: 'd_' + Date.now(), name: 'New Day' }])}
                  className="text-xs text-white/40 underline active:opacity-60"
                >
                  + Add day
                </button>
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
