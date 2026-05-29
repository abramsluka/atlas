'use client'

import { useState, useEffect, useRef, type ReactNode, useCallback } from 'react'
import {
  useSupplements,
  useSupplementLogs,
  useWaterLogs,
  useCaffeineLogs,
  useHealthProfile,
  useWaterHistory,
  useOuraData,
  useOuraHistory,
  useWhoopData,
} from '@/features/health/queries'
import {
  useCreateSupplement,
  useUpdateSupplement,
  useDeleteSupplement,
  useLogSupplementDose,
  useUnlogSupplementDose,
  useLogWater,
  useDeleteWaterLog,
  useUpdateHealthProfile,
  useLogCaffeine,
  useDeleteCaffeineLog,
} from '@/features/health/mutations'
import { useFoodLogs } from '@/features/food/queries'
import { useLogFood, useUpdateFoodLog, useDeleteFoodLog, useCalculateCalorieTarget } from '@/features/food/mutations'
import { resizeImage } from '@/features/food/resize'
import type { FoodLog } from '@/features/food/types'
import type {
  Supplement,
  SupplementLog,
  WaterLog,
  CaffeineLog,
  HealthProfile,
  SubstanceEntry,
  OuraData,
  WhoopData,
  TimeSlot,
} from '@/features/health/types'
import {
  STACK_WINDOWS,
  searchSupplements,
  type SupplementDbEntry,
  type StackWindow,
} from '@/features/health/supplementDb'
import { SUBSTANCE_DB } from '@/features/health/substanceDb'
import DebloatSection from './DebloatSection'

interface Props {
  supplements: Supplement[]
  todayLogs: SupplementLog[]
  todayWater: WaterLog[]
  todayCaffeine: CaffeineLog[]
  profile: HealthProfile | null
  ouraData: OuraData | null
  whoopData: WhoopData | null
  hasOura: boolean
  hasWhoop: boolean
  today: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-zinc-400'
  if (score >= 70) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '--'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getStackDate(): string {
  const now = new Date()
  if (now.getHours() < 6) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday.toISOString().split('T')[0]
  }
  return now.toISOString().split('T')[0]
}

// ─── Wearables Section ──────────────────────────────────────────────────────

function Sparkline({
  values,
  color,
}: {
  values: Array<number | null>
  color: string
}) {
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (nums.length < 2) {
    return <div className="h-5 w-full" />
  }
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const w = 100
  const h = 20
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const points = values
    .map((v, i) => {
      if (v == null) return null
      const x = i * step
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .filter(Boolean)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-5 w-full">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function WearablesSection({
  hasOura,
  hasWhoop,
  initialOura,
  initialWhoop,
  today,
}: {
  hasOura: boolean
  hasWhoop: boolean
  initialOura: OuraData | null
  initialWhoop: WhoopData | null
  today: string
}) {
  const { data: oura } = useOuraData(today, hasOura, initialOura)
  const { data: whoop } = useWhoopData(today, hasWhoop, initialWhoop)
  const { data: ouraHistory } = useOuraHistory(14, hasOura)

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Wearables
      </h2>
      <div className="space-y-3">
        <div className="rounded-xl bg-zinc-900 p-4">
          <p className="mb-3 text-xs font-medium text-zinc-500">Oura Ring</p>
          {!hasOura ? (
            <a
              href="/api/health/oura/connect"
              className="block rounded-lg bg-white px-3 py-2 text-center text-xs font-semibold text-black"
            >
              Connect
            </a>
          ) : !oura ? (
            <p className="text-xs text-zinc-500">Syncing...</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Readiness</p>
                  <p className={`text-3xl font-bold ${scoreColor(oura.readiness?.score)}`}>
                    {oura.readiness?.score ?? '--'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Steps</p>
                  <p className="text-3xl font-bold text-white">
                    {oura.activity?.steps != null ? oura.activity.steps.toLocaleString() : '--'}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Sleep</p>
                  <p className="text-sm font-semibold text-white">{oura.sleep?.score ?? '--'}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">HRV</p>
                  <p className="text-sm font-semibold text-white">
                    {oura.sleep?.average_hrv != null ? `${Math.round(oura.sleep.average_hrv)}ms` : '--'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Duration</p>
                  <p className="text-sm font-semibold text-white">
                    {formatDuration(oura.sleep?.total_sleep_duration)}
                  </p>
                </div>
              </div>
              {ouraHistory && ouraHistory.length >= 2 && (
                <div className="space-y-2 pt-2 border-t border-white/[0.04]">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">14-day trend</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-[10px] text-zinc-500">Readiness</span>
                      <Sparkline values={ouraHistory.map(p => p.readiness)} color="#6BE3A4" />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-[10px] text-zinc-500">HRV</span>
                      <Sparkline values={ouraHistory.map(p => p.hrv)} color="#7B5BB0" />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-[10px] text-zinc-500">Sleep</span>
                      <Sparkline values={ouraHistory.map(p => p.sleep_score)} color="#F2C063" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-zinc-900 p-4">
          <p className="mb-3 text-xs font-medium text-zinc-500">Whoop</p>
          {!hasWhoop ? (
            <a
              href="/api/health/whoop/connect"
              className="block rounded-lg bg-white px-3 py-2 text-center text-xs font-semibold text-black"
            >
              Connect
            </a>
          ) : !whoop ? (
            <p className="text-xs text-zinc-500">Syncing...</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Recovery</p>
                <p className={`text-3xl font-bold ${scoreColor(whoop.recovery?.score)}`}>
                  {whoop.recovery?.score != null ? `${whoop.recovery.score}%` : '--'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Strain</p>
                  <p className="text-sm font-semibold text-white">
                    {whoop.workout?.strain != null ? whoop.workout.strain.toFixed(1) : '--'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Cals</p>
                  <p className="text-sm font-semibold text-white">
                    {whoop.workout?.kilojoule != null
                      ? Math.round(whoop.workout.kilojoule * 0.239)
                      : '--'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── Stack Tracker ────────────────────────────────────────────────────────────

function StackTicker({
  supplements,
  logs,
}: {
  supplements: Supplement[]
  logs: SupplementLog[]
}) {
  const [tickerIdx, setTickerIdx] = useState(0)
  const [fading, setFading] = useState(false)

  const currentHour = new Date().getHours() + new Date().getMinutes() / 60

  const issues: Array<{ type: 'missed' | 'low'; text: string }> = []
  supplements.forEach(s => {
    const slot = s.times[0] as TimeSlot | undefined
    const win = STACK_WINDOWS.find(w => w.key === (slot ?? 'anytime'))
    const isPastCutoff = win?.cutoffHour != null && currentHour > win.cutoffHour
    const taken = logs.some(l => l.supplement_id === s.id)
    if (isPastCutoff && !taken) {
      issues.push({ type: 'missed', text: `${s.name} — missed ${(win?.title ?? 'daily').toLowerCase()} dose` })
    }
    if (s.running_low) {
      issues.push({ type: 'low', text: `${s.name} — running low, reorder soon` })
    }
  })

  useEffect(() => {
    if (issues.length <= 1) return
    const id = setInterval(() => {
      setFading(true)
      setTimeout(() => {
        setTickerIdx(i => (i + 1) % issues.length)
        setFading(false)
      }, 280)
    }, 5000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.length])

  const hasMissed = issues.some(i => i.type === 'missed')
  const safeIdx = issues.length > 0 ? tickerIdx % issues.length : 0
  const msg = issues.length === 0 ? 'All caught up — keep it rolling' : issues[safeIdx].text

  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 mb-4 rounded-[10px] bg-black/25 border border-white/[0.04] min-h-[36px]">
      <span
        className={[
          'w-2 h-2 rounded-full shrink-0 transition-colors duration-300',
          issues.length === 0 ? 'bg-[#6BE3A4]' :
          hasMissed ? 'bg-[#FF6B6B] animate-ticker-pulse' :
          'bg-[#FF8A4D]',
        ].join(' ')}
      />
      <span className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 shrink-0">
        STACK
      </span>
      <span className="text-zinc-600 shrink-0">·</span>
      <span
        className={[
          'flex-1 text-xs font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis',
          'transition-opacity duration-[280ms]',
          fading ? 'opacity-0' : 'opacity-100',
        ].join(' ')}
      >
        {msg}
      </span>
      <span className="font-mono text-[11px] text-zinc-500 shrink-0 tabular-nums">
        {issues.length}/{supplements.length}
      </span>
    </div>
  )
}

function SupplementRow({
  supplement,
  log,
  isPastCutoff,
  confirmingDelete,
  onToggle,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onToggleLow,
  onUpdateName,
  onUpdateMeta,
  togglePending,
  deletePending,
}: {
  supplement: Supplement
  log: SupplementLog | undefined
  isPastCutoff: boolean
  confirmingDelete: boolean
  onToggle: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
  onToggleLow: () => void
  onUpdateName: (name: string) => void
  onUpdateMeta: (dose: string, notes: string) => void
  togglePending: boolean
  deletePending: boolean
}) {
  const taken = !!log
  const missed = isPastCutoff && !taken
  const metaStr = [supplement.dose, supplement.notes].filter(Boolean).join(' · ')

  const [editingName, setEditingName] = useState(false)
  const [editingMeta, setEditingMeta] = useState(false)
  const nameRef = useRef<HTMLSpanElement>(null)
  const metaRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editingName || !nameRef.current) return
    nameRef.current.textContent = supplement.name
    nameRef.current.focus()
    const r = document.createRange()
    r.selectNodeContents(nameRef.current)
    r.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(r)
  }, [editingName, supplement.name])

  useEffect(() => {
    if (!editingMeta || !metaRef.current) return
    metaRef.current.textContent = metaStr
    metaRef.current.focus()
    const r = document.createRange()
    r.selectNodeContents(metaRef.current)
    r.collapse(false)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(r)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMeta])

  if (confirmingDelete) {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[10px] bg-white/[0.035] border border-transparent mb-1.5">
        <span className="text-sm text-zinc-400">Remove from stack?</span>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onCancelDelete}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={onDelete}
            disabled={deletePending}
            className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 disabled:opacity-40"
          >
            {deletePending ? '...' : 'Remove'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={[
        'grid items-center px-3 py-2.5 rounded-[10px] border mb-1.5 transition-[background,border-color]',
        'grid-cols-[32px_1fr_auto_auto] gap-2.5',
        taken
          ? 'bg-[#1D9E75]/[0.08] border-transparent'
          : missed
          ? 'bg-white/[0.035] border-[rgba(239,68,68,0.45)] animate-pulse-red'
          : 'bg-white/[0.035] border-transparent hover:bg-white/[0.05]',
      ].join(' ')}
    >
      {/* Checkbox */}
      <button
        onClick={onToggle}
        disabled={togglePending}
        aria-label="Mark taken"
        className={[
          'w-7 h-7 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-all duration-200 disabled:opacity-60',
          taken
            ? 'bg-[#1D9E75] border-[#1D9E75] text-white shadow-[0_0_12px_rgba(29,158,117,0.35)]'
            : missed
            ? 'bg-transparent border-[rgba(239,68,68,0.55)] text-transparent hover:border-[#1D9E75]'
            : 'bg-transparent border-white/[0.12] text-transparent hover:border-[#1D9E75]',
        ].join(' ')}
      >
        {taken ? '✓' : ''}
      </button>

      {/* Body */}
      <div className="min-w-0">
        {editingName ? (
          <span
            ref={nameRef}
            contentEditable
            suppressContentEditableWarning
            className="block text-sm font-semibold text-white outline outline-1 outline-white/25 outline-offset-[4px] rounded"
            onBlur={() => {
              setEditingName(false)
              const v = nameRef.current?.textContent?.trim()
              if (v && v !== supplement.name) onUpdateName(v)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); nameRef.current?.blur() }
              if (e.key === 'Escape') {
                if (nameRef.current) nameRef.current.textContent = supplement.name
                setEditingName(false)
              }
            }}
          />
        ) : (
          <span
            className={[
              'text-sm font-semibold cursor-text select-none',
              taken ? 'line-through text-zinc-500' : 'text-white',
            ].join(' ')}
            onClick={() => setEditingName(true)}
          >
            {supplement.name}
          </span>
        )}
        {editingMeta ? (
          <div
            ref={metaRef}
            contentEditable
            suppressContentEditableWarning
            className="mt-0.5 text-[11px] text-zinc-400 outline outline-1 outline-white/20 outline-offset-[4px] rounded cursor-text"
            onBlur={() => {
              setEditingMeta(false)
              const text = metaRef.current?.textContent?.trim() ?? ''
              const parts = text.split(/\s*·\s*/)
              onUpdateMeta(parts[0] ?? '', parts.slice(1).join(' · '))
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); metaRef.current?.blur() }
              if (e.key === 'Escape') {
                if (metaRef.current) metaRef.current.textContent = metaStr
                setEditingMeta(false)
              }
            }}
          />
        ) : (
          <div
            className={[
              'mt-0.5 text-[11px] cursor-text',
              metaStr ? 'text-zinc-500' : 'text-zinc-700 italic',
            ].join(' ')}
            onClick={() => setEditingMeta(true)}
          >
            {metaStr || 'add notes…'}
          </div>
        )}
      </div>

      {/* Running low toggle */}
      <button
        onClick={onToggleLow}
        className={[
          'text-[10px] px-2 py-1 rounded border font-mono font-semibold tracking-[0.04em] whitespace-nowrap transition-all',
          supplement.running_low
            ? 'bg-[rgba(163,45,45,0.10)] border-[rgba(163,45,45,0.4)] text-[#FF8A4D]'
            : 'bg-transparent border-white/[0.12] text-zinc-500 hover:border-[rgba(163,45,45,0.4)] hover:text-[#FF8A4D]',
        ].join(' ')}
      >
        ↓ Running low
      </button>

      {/* Delete */}
      <button
        onClick={onConfirmDelete}
        aria-label="Delete"
        className="w-7 h-7 flex items-center justify-center rounded border border-white/[0.12] text-zinc-500 text-base leading-none opacity-70 hover:opacity-100 hover:text-[#FF6B6B] hover:border-[rgba(239,68,68,0.45)] hover:bg-[rgba(239,68,68,0.08)] transition-all"
      >
        ×
      </button>
    </div>
  )
}

function StackWindowSection({
  win,
  supplements,
  logs,
  confirmDeleteId,
  togglePending,
  deletePending,
  onToggle,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onToggleLow,
  onUpdateName,
  onUpdateMeta,
}: {
  win: StackWindow
  supplements: Supplement[]
  logs: SupplementLog[]
  confirmDeleteId: string | null
  togglePending: boolean
  deletePending: boolean
  onToggle: (s: Supplement) => void
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
  onDelete: (id: string) => void
  onToggleLow: (s: Supplement) => void
  onUpdateName: (id: string, name: string) => void
  onUpdateMeta: (id: string, dose: string, notes: string) => void
}) {
  if (supplements.length === 0) return null
  const currentHour = new Date().getHours() + new Date().getMinutes() / 60
  const isPastCutoff = win.cutoffHour != null && currentHour > win.cutoffHour

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-white/[0.04]">
        <span className="text-base">{win.icon}</span>
        <span className="text-sm font-bold text-white">{win.title}</span>
        <span className="text-[11px] text-zinc-500 font-medium">{win.time}</span>
      </div>
      <div>
        {supplements.map(s => (
          <SupplementRow
            key={s.id}
            supplement={s}
            log={logs.find(l => l.supplement_id === s.id)}
            isPastCutoff={isPastCutoff}
            confirmingDelete={confirmDeleteId === s.id}
            onToggle={() => onToggle(s)}
            onConfirmDelete={() => onConfirmDelete(s.id)}
            onCancelDelete={onCancelDelete}
            onDelete={() => onDelete(s.id)}
            onToggleLow={() => onToggleLow(s)}
            onUpdateName={(name) => onUpdateName(s.id, name)}
            onUpdateMeta={(dose, notes) => onUpdateMeta(s.id, dose, notes)}
            togglePending={togglePending}
            deletePending={deletePending}
          />
        ))}
      </div>
    </div>
  )
}

function AddStackForm({
  onAdd,
}: {
  onAdd: (name: string, dose: string, notes: string, win: TimeSlot) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [dose, setDose] = useState('')
  const [timeWindow, setTimeWindow] = useState<TimeSlot>('morning')
  const [pendingNote, setPendingNote] = useState('')
  const [results, setResults] = useState<SupplementDbEntry[]>([])
  const [showResults, setShowResults] = useState(false)
  const [adding, setAdding] = useState(false)
  const [aiSuggested, setAiSuggested] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Local DB search on every keystroke
  useEffect(() => {
    if (!name.trim()) {
      setResults([])
      setShowResults(false)
      return
    }
    const matches = searchSupplements(name)
    setResults(matches)
    setShowResults(matches.length > 0)
  }, [name])

  // Claude API fallback after 600ms when no local DB match
  useEffect(() => {
    if (!name.trim() || results.length > 0) return
    const id = setTimeout(async () => {
      try {
        const res = await fetch('/api/health/supplements/suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (data.dose && !dose) {
          setDose(data.dose)
          setAiSuggested(true)
        }
        const suggestedWindow = (data.times ?? []).find(
          (t: string) => ['morning', 'lunch', 'evening', 'anytime'].includes(t)
        ) as TimeSlot | undefined
        if (suggestedWindow) setTimeWindow(suggestedWindow)
      } catch { /* ignore */ }
    }, 600)
    return () => clearTimeout(id)
  }, [name, results.length, dose])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setShowResults(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const selectResult = (s: SupplementDbEntry) => {
    setName(s.name)
    setDose(s.dose)
    setTimeWindow(s.window)
    setPendingNote(s.note)
    setShowResults(false)
    setAiSuggested(false)
  }

  const handleAdd = async () => {
    if (!name.trim()) return
    setAdding(true)
    try {
      await onAdd(name.trim(), dose.trim(), pendingNote, timeWindow)
      setName('')
      setDose('')
      setTimeWindow('morning')
      setPendingNote('')
      setAiSuggested(false)
      setResults([])
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="mt-4 pt-3.5 border-t border-white/[0.04]">
      <p className="font-mono text-[10px] font-bold tracking-[0.16em] uppercase text-zinc-500 mb-2.5">
        Add to stack
      </p>
      <div ref={wrapRef} className="relative">
        <div className="grid grid-cols-[1fr_1fr_110px_80px] gap-1.5 items-center">
          {/* Name input */}
          <div className="relative">
            <input
              className="w-full text-[13px] px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-black/25 text-white placeholder-zinc-600 outline-none focus:border-white/40 transition-all"
              placeholder="Name (e.g. B-complex)"
              value={name}
              autoComplete="off"
              spellCheck={false}
              onChange={e => {
                setName(e.target.value)
                setAiSuggested(false)
                setPendingNote('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  if (showResults && results.length > 0) {
                    selectResult(results[0])
                  } else {
                    handleAdd()
                  }
                }
                if (e.key === 'Escape') setShowResults(false)
              }}
              onFocus={() => { if (results.length > 0) setShowResults(true) }}
            />
            {showResults && (
              <div className="absolute top-[calc(100%+6px)] left-0 w-[max(100%,320px)] bg-[rgba(15,15,18,0.96)] border border-white/[0.12] rounded-xl max-h-72 overflow-y-auto backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.65)] z-50 p-1.5">
                {results.map(s => {
                  const winMeta = STACK_WINDOWS.find(w => w.key === s.window) ?? STACK_WINDOWS[3]
                  return (
                    <button
                      key={s.name}
                      className="flex gap-3 items-center w-full px-3 py-2.5 rounded-lg bg-transparent text-left text-zinc-400 hover:bg-white/[0.06] transition-colors"
                      onMouseDown={e => { e.preventDefault(); selectResult(s) }}
                    >
                      <span className="text-[17px] w-6 text-center shrink-0">{s.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-white">{s.name}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 truncate">
                          {s.dose} · {winMeta.icon} {winMeta.title.toLowerCase()} · {s.note}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Dose input */}
          <input
            className="text-[13px] px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-black/25 text-white placeholder-zinc-600 outline-none focus:border-white/40 transition-all"
            placeholder="Dose (e.g. 1 cap)"
            value={dose}
            onChange={e => { setDose(e.target.value); setAiSuggested(false) }}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          />

          {/* Window select */}
          <select
            className="text-[13px] px-3 py-2.5 rounded-[10px] border border-white/[0.12] bg-black/25 text-white outline-none focus:border-white/40 transition-all cursor-pointer"
            value={timeWindow}
            onChange={e => setTimeWindow(e.target.value as TimeSlot)}
          >
            <option value="morning">Morning</option>
            <option value="lunch">Lunch</option>
            <option value="evening">Evening</option>
            <option value="anytime">Anytime</option>
          </select>

          {/* Add button */}
          <button
            onClick={handleAdd}
            disabled={!name.trim() || adding}
            className="text-[13px] px-3 py-2.5 rounded-[10px] border border-white/85 bg-gradient-to-b from-white to-[#E8E5DD] text-[#0A0A0B] font-bold cursor-pointer disabled:opacity-40 shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_4px_14px_rgba(0,0,0,0.30)] hover:-translate-y-px active:scale-[0.97] transition-transform"
          >
            {adding ? '...' : '+ Add'}
          </button>
        </div>

        {aiSuggested && (
          <p className="mt-1.5 pl-1 text-[10px] text-zinc-600">✦ AI suggested</p>
        )}
      </div>
    </div>
  )
}

function StackTracker({
  initialSupplements,
  initialLogs,
}: {
  initialSupplements: Supplement[]
  initialLogs: SupplementLog[]
}) {
  const [stackDate] = useState(getStackDate)
  const { data: supplements } = useSupplements(initialSupplements)
  const { data: logs } = useSupplementLogs(stackDate, initialLogs)
  const logDose = useLogSupplementDose(stackDate)
  const unlogDose = useUnlogSupplementDose(stackDate)
  const deleteSupplement = useDeleteSupplement()
  const createSupplement = useCreateSupplement()
  const updateSupplement = useUpdateSupplement()

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Re-render every minute so missed indicators update as time passes
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const allSupplements = supplements ?? []
  const allLogs = logs ?? []

  // Group by primary time window (times[0])
  const grouped = new Map<TimeSlot, Supplement[]>()
  STACK_WINDOWS.forEach(w => grouped.set(w.key, []))
  allSupplements.forEach(s => {
    const slot = (s.times[0] as TimeSlot | undefined) ?? 'anytime'
    const key: TimeSlot = STACK_WINDOWS.some(w => w.key === slot) ? slot : 'anytime'
    grouped.get(key)!.push(s)
  })
  grouped.forEach((arr, key) => grouped.set(key, [...arr].sort((a, b) => a.order_index - b.order_index)))

  const totalSlots = allSupplements.length
  const takenCount = allSupplements.filter(s => allLogs.some(l => l.supplement_id === s.id)).length
  const pct = totalSlots > 0 ? takenCount / totalSlots : 0

  async function handleToggle(s: Supplement) {
    const slot = (s.times[0] as TimeSlot | undefined) ?? 'anytime'
    const existingLog = allLogs.find(l => l.supplement_id === s.id && l.time_slot === slot)
    if (existingLog) {
      await unlogDose.mutateAsync(existingLog.id)
    } else {
      await logDose.mutateAsync({ supplement_id: s.id, time_slot: slot })
    }
  }

  async function handleAdd(name: string, dose: string, notes: string, win: TimeSlot) {
    await createSupplement.mutateAsync({
      name,
      dose,
      notes: notes || null,
      times: [win],
      running_low: false,
      order_index: grouped.get(win)?.length ?? 0,
    })
  }

  function handleToggleLow(s: Supplement) {
    updateSupplement.mutate({ id: s.id, running_low: !s.running_low })
  }

  function handleUpdateName(id: string, name: string) {
    updateSupplement.mutate({ id, name })
  }

  function handleUpdateMeta(id: string, dose: string, notes: string) {
    updateSupplement.mutate({ id, dose: dose || null, notes: notes || null })
  }

  const togglePending = logDose.isPending || unlogDose.isPending
  const deletePending = deleteSupplement.isPending

  return (
    <section>
      <StackTicker supplements={allSupplements} logs={allLogs} />

      {/* Header */}
      <div className="mb-4">
        <div className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-zinc-500 mb-1.5">
          Daily stack
        </div>
        <div className="text-2xl font-bold tracking-tight text-white leading-tight">
          Tap each as you take it
        </div>
        <div className="font-mono text-xs text-zinc-500 mt-1.5 tabular-nums">
          {totalSlots === 0
            ? '— / — taken today · resets at 6 AM'
            : `${takenCount} / ${totalSlots} taken today · resets at 6 AM`}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-[5px] bg-white/[0.05] rounded-full overflow-hidden mb-5">
        <div
          className="h-full bg-white rounded-full shadow-[inset_0_1px_0_rgba(255,255,255,0.4)] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {totalSlots === 0 && (
        <p className="text-xs text-zinc-700 italic px-3 py-2">
          No items yet — add one below to start your stack.
        </p>
      )}

      {STACK_WINDOWS.map(win => (
        <StackWindowSection
          key={win.key}
          win={win}
          supplements={grouped.get(win.key) ?? []}
          logs={allLogs}
          confirmDeleteId={confirmDeleteId}
          togglePending={togglePending}
          deletePending={deletePending}
          onToggle={handleToggle}
          onConfirmDelete={setConfirmDeleteId}
          onCancelDelete={() => setConfirmDeleteId(null)}
          onDelete={async (id) => {
            await deleteSupplement.mutateAsync(id)
            setConfirmDeleteId(null)
          }}
          onToggleLow={handleToggleLow}
          onUpdateName={handleUpdateName}
          onUpdateMeta={handleUpdateMeta}
        />
      ))}

      <AddStackForm onAdd={handleAdd} />
    </section>
  )
}

// ─── Water Section ────────────────────────────────────────────────────────────

const ML_PER_OZ = 29.5735

interface WaterProfile {
  weight_lbs: number | null
  age: number | null
  sex: 'm' | 'f' | 'o' | null
  height_cm: number | null
  activity_hrs_per_week: number
  caffeine_mg_per_day: number
  water_unit: 'bottle' | 'glass' | 'oz' | 'ml'
  bottle_ml: number
  glass_ml: number
  weight_unit: 'lb' | 'kg'
  substances: SubstanceEntry[]
  daily_water_target_oz: number | null
}

function defaultWaterProfile(): WaterProfile {
  return {
    weight_lbs: null, age: null, sex: null, height_cm: null,
    activity_hrs_per_week: 0, caffeine_mg_per_day: 200,
    water_unit: 'bottle', bottle_ml: 500, glass_ml: 250,
    weight_unit: 'lb', substances: [], daily_water_target_oz: null,
  }
}

function mergeProfile(p: HealthProfile | null | undefined): WaterProfile {
  const d = defaultWaterProfile()
  if (!p) return d
  return {
    weight_lbs: p.weight_lbs ?? d.weight_lbs,
    age: p.age ?? d.age,
    sex: p.sex ?? d.sex,
    height_cm: p.height_cm ?? d.height_cm,
    activity_hrs_per_week: p.activity_hrs_per_week ?? d.activity_hrs_per_week,
    caffeine_mg_per_day: p.caffeine_mg_per_day ?? d.caffeine_mg_per_day,
    water_unit: p.water_unit ?? d.water_unit,
    bottle_ml: p.bottle_ml ?? d.bottle_ml,
    glass_ml: p.glass_ml ?? d.glass_ml,
    weight_unit: p.weight_unit ?? d.weight_unit,
    substances: p.substances ?? d.substances,
    daily_water_target_oz: p.daily_water_target_oz ?? d.daily_water_target_oz,
  }
}

function subExtraMl(s: SubstanceEntry): number {
  const dose = s.dose ?? s.defaultDose ?? 0
  return Math.max(0, dose * (s.mlPerUnit ?? 0))
}

function computeTarget(p: WaterProfile) {
  const wKg = p.weight_lbs != null
    ? (p.weight_unit === 'kg' ? p.weight_lbs : p.weight_lbs / 2.20462)
    : 0
  const base = wKg * 35
  const exercise = (p.activity_hrs_per_week || 0) / 7 * 500
  const caffeine = Math.max(0, (p.caffeine_mg_per_day || 0) - 200) * 1.5
  const subs = (p.substances || []).reduce((acc, x) => acc + subExtraMl(x), 0)
  let adjust = 0
  if (p.sex === 'm') adjust += 200
  if ((p.age || 0) >= 50) adjust += 100
  return { base, exercise, caffeine, subs, adjust, total: base + exercise + caffeine + subs + adjust }
}

function unitVolOz(p: WaterProfile): number {
  if (p.water_unit === 'bottle') return (p.bottle_ml || 500) / ML_PER_OZ
  if (p.water_unit === 'glass') return (p.glass_ml || 250) / ML_PER_OZ
  if (p.water_unit === 'oz') return 1
  return 1 / ML_PER_OZ
}

function unitLabelSingular(p: WaterProfile): string {
  const map = { bottle: 'bottle', glass: 'glass', oz: 'oz', ml: 'ml' }
  return map[p.water_unit] ?? 'bottle'
}

function unitLabelPlural(p: WaterProfile): string {
  const map = { bottle: 'bottles', glass: 'glasses', oz: 'oz', ml: 'ml' }
  return map[p.water_unit] ?? 'bottles'
}

function fmtMl(ml: number): string {
  if (ml >= 1000) return (ml / 1000).toFixed(1) + ' L'
  return Math.round(ml) + ' ml'
}

function WaterSpark({ history, targetUnits, unitVol }: {
  history: { date: string; total_oz: number }[]
  targetUnits: number
  unitVol: number
}) {
  const W = 280, H = 70, pad = 4
  const data = history.map(h => h.total_oz / unitVol)
  const maxVal = Math.max(targetUnits, ...data, 1)
  const colW = (W - pad * 2) / (data.length || 1)
  const barW = colW * 0.7
  const targetY = H - pad - (targetUnits / maxVal) * (H - pad * 2)
  return (
    <svg viewBox="0 0 280 70" style={{ width: '100%', height: 70, display: 'block' }} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={targetY.toFixed(1)} y2={targetY.toFixed(1)}
        stroke="rgba(255,255,255,0.20)" strokeWidth="1" strokeDasharray="3 3" />
      {data.map((v, i) => {
        const x = pad + i * colW + (colW - barW) / 2
        const h = (v / maxVal) * (H - pad * 2)
        const y = H - pad - h
        return (
          <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)}
            width={barW.toFixed(1)} height={Math.max(0, h).toFixed(1)} rx="2"
            fill={v >= targetUnits ? '#6ee7b7' : 'rgba(255,138,138,0.5)'} />
        )
      })}
    </svg>
  )
}

function WhyRow({ label, val, total }: { label: string; val: string; total?: boolean }) {
  return (
    <div className={`flex justify-between items-baseline text-[13px] py-1 ${total ? 'border-t border-white/[0.06] mt-2 pt-2.5' : ''}`}>
      <span className={total ? 'text-[#6ee7b7] font-bold' : 'text-white/60'}>{label}</span>
      <span className={`font-semibold font-mono tabular-nums ${total ? 'text-[#6ee7b7]' : 'text-white'}`}>{val}</span>
    </div>
  )
}

function WSettingSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h4 className="mb-2 text-[11px] font-extrabold tracking-[0.14em] uppercase text-white/40">{title}</h4>
      {children}
    </div>
  )
}

function WSettingField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5 mb-2.5">
      <label className="text-[11px] text-white/40 font-bold tracking-[0.06em] uppercase">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-white/40 mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

function WSegControl<T extends string>({ value, options, onChange }: {
  value: T
  options: { label: string; value: T }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 bg-white/[0.04] border border-white/[0.06] rounded-[10px] p-[3px]">
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
          className={`flex-1 py-[9px] rounded-[7px] text-[12px] font-semibold border-0 cursor-pointer transition-colors ${
            value === opt.value
              ? 'text-[#0a0a0b]'
              : 'bg-transparent text-white/40'
          }`}
          style={value === opt.value ? { background: 'linear-gradient(180deg, #ffffff 0%, #e8e5dd 100%)' } : {}}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

const INPUT_CLS = 'bg-black/[0.28] border border-white/[0.06] text-white text-[14px] px-3 py-2.5 rounded-[10px] outline-none focus:border-[rgba(110,231,183,0.40)] w-full'

function WaterSection({
  initialWater,
  initialCaffeine: _initialCaffeine,
  initialProfile,
  today,
}: {
  initialWater: WaterLog[]
  initialCaffeine: CaffeineLog[]
  initialProfile: HealthProfile | null
  today: string
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const [showSubResults, setShowSubResults] = useState(false)
  const [localProfile, setLocalProfile] = useState<WaterProfile>(() => mergeProfile(initialProfile))
  const [savingSettings, setSavingSettings] = useState(false)

  const { data: waterLogs } = useWaterLogs(today, initialWater)
  const { data: profileData } = useHealthProfile(initialProfile)
  const { data: history } = useWaterHistory()
  const logWater = useLogWater(today)
  const deleteWater = useDeleteWaterLog(today)
  const updateProfile = useUpdateHealthProfile()

  useEffect(() => {
    if (!settingsOpen) setLocalProfile(mergeProfile(profileData))
  }, [settingsOpen, profileData])

  const totalOz = waterLogs?.reduce((sum, l) => sum + l.amount_oz, 0) ?? 0
  const unitVol = unitVolOz(localProfile)
  const calc = computeTarget(localProfile)
  const targetOz = localProfile.daily_water_target_oz ?? calc.total / ML_PER_OZ
  const targetUnits = Math.max(1, Math.ceil(targetOz / unitVol))
  const count = totalOz / unitVol
  const pctRaw = (count / targetUnits) * 100
  const fillPct = Math.min(150, pctRaw) / 1.5

  function helperText() {
    if (count === 0) return { text: 'Start the day — first one in.', good: false }
    if (pctRaw < 50) return { text: 'Behind pace — drink one in the next hour.', good: false }
    if (pctRaw < 100) return { text: `${Math.max(0, targetUnits - Math.floor(count))} to go. Pacing well.`, good: false }
    if (pctRaw < 130) return { text: '✓ Target hit — top up if you train this evening.', good: true }
    return { text: 'Strong — way past target.', good: true }
  }
  const helper = helperText()

  const subMatches = subSearch.trim()
    ? SUBSTANCE_DB.filter(s =>
        s.name.toLowerCase().includes(subSearch.toLowerCase()) ||
        s.cat.toLowerCase().includes(subSearch.toLowerCase())
      ).slice(0, 8)
    : []

  function updateLocal(partial: Partial<WaterProfile>) {
    setLocalProfile(prev => ({ ...prev, ...partial }))
  }

  function addSubstance(id: string) {
    const sub = SUBSTANCE_DB.find(s => s.id === id)
    if (!sub || localProfile.substances.find(s => s.id === id)) return
    updateLocal({
      substances: [...localProfile.substances, {
        id: sub.id, name: sub.name, cat: sub.cat,
        unit: sub.unit, mlPerUnit: sub.mlPerUnit,
        defaultDose: sub.defaultDose, dose: sub.defaultDose, note: sub.note,
      }],
    })
    setSubSearch('')
    setShowSubResults(false)
  }

  async function handleSave() {
    setSavingSettings(true)
    try {
      await updateProfile.mutateAsync(localProfile)
      setSettingsOpen(false)
    } finally {
      setSavingSettings(false)
    }
  }

  const last7 = (history ?? []).slice(0, 7)
  const sparkHistory = [...(history ?? [])].reverse()

  const displayCount = count.toFixed(1).replace(/\.0$/, '')

  return (
    <section>
      {/* Divider */}
      <div className="flex items-center gap-4 mb-3.5">
        <div className="flex-1 h-px bg-white/[0.10]" />
        <span className="text-[11px] font-semibold tracking-[0.22em] text-white/85">WATER</span>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>

      {/* Hero Card */}
      <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] px-5 pt-[22px] pb-[18px] mb-3.5">
        <div className="text-[10px] font-bold tracking-[0.20em] uppercase text-white/40 mb-2">
          {unitLabelPlural(localProfile).toUpperCase()} DRANK TODAY
        </div>
        <div className="flex items-baseline gap-2 mb-2.5">
          <span className="text-[56px] font-bold leading-none tabular-nums tracking-[-0.03em]">
            {displayCount}
          </span>
          <span className="text-[18px] text-white/40 font-medium">/ {targetUnits}</span>
        </div>

        {/* Progress bar */}
        <div className="relative my-3.5 mb-[22px]">
          <div className="relative h-7 rounded-[14px] bg-white/[0.04] overflow-hidden">
            <div
              className="absolute top-0 bottom-0 left-0 rounded-[14px] transition-[width] duration-[400ms] ease-out"
              style={{
                width: `${fillPct}%`,
                background: pctRaw > 100
                  ? 'linear-gradient(90deg, #6ee7b7, #fbbf24)'
                  : 'linear-gradient(90deg, #7DD3FC, #6ee7b7)',
                boxShadow: '0 0 18px rgba(110,231,183,0.18)',
              }}
            />
            <div className="absolute top-0 bottom-0 w-px bg-white/[0.18]" style={{ left: `${(65 / 1.5).toFixed(1)}%` }} />
            <div className="absolute top-0 bottom-0 w-px bg-white/[0.18]" style={{ left: `${(100 / 1.5).toFixed(1)}%` }} />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] text-white/40 font-mono">
            <span>0</span>
            <span className="text-[#6ee7b7] font-bold tracking-[0.10em] lowercase">healthy zone</span>
            <span>{Math.ceil(targetUnits * 1.5)}+</span>
          </div>
        </div>

        {/* Action row */}
        <div className="grid gap-2.5" style={{ gridTemplateColumns: '56px 1fr' }}>
          <button
            type="button"
            disabled={totalOz <= 0 || deleteWater.isPending}
            onClick={() => {
              const last = waterLogs?.[waterLogs.length - 1]
              if (last) deleteWater.mutate(last.id)
            }}
            className="rounded-[16px] bg-white/[0.06] text-white text-[22px] font-bold disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/[0.10] transition-colors"
            aria-label="Undo last"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => logWater.mutate(unitVol)}
            disabled={logWater.isPending}
            className="rounded-[16px] text-[#0a0a0b] text-base font-bold py-4 flex items-center justify-center gap-2 active:scale-[0.98] hover:-translate-y-px transition-transform disabled:opacity-50"
            style={{
              background: 'linear-gradient(180deg, #ffffff 0%, #e8e5dd 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 14px rgba(0,0,0,0.40)',
            }}
          >
            <span>Drank a {unitLabelSingular(localProfile)}</span>
            <span>↑</span>
          </button>
        </div>

        <p className={`text-center text-[12px] mt-3 ${helper.good ? 'text-[#6ee7b7]' : 'text-white/40 italic'}`}>
          {helper.text}
        </p>

        {/* Why this target? */}
        <button
          type="button"
          onClick={() => setWhyOpen(o => !o)}
          aria-expanded={whyOpen}
          className="w-full flex items-center justify-between bg-transparent border border-white/[0.06] text-white/60 rounded-[10px] px-3.5 py-[11px] cursor-pointer mt-3.5 text-[12px] font-semibold tracking-[0.04em] hover:bg-white/[0.04] hover:text-white transition-colors"
        >
          <span>Why this target?</span>
          <span className={`text-[14px] transition-transform duration-200 inline-block ${whyOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {whyOpen && (
          <div className="mt-2 px-4 py-3.5 bg-white/[0.025] border border-white/[0.06] rounded-[10px]">
            {(() => {
              const wDisp = localProfile.weight_lbs?.toFixed(0) ?? '?'
              return (
                <>
                  <WhyRow label={`Base (${wDisp} ${localProfile.weight_unit} × 35 ml)`} val={fmtMl(calc.base)} />
                  {calc.exercise > 0 && <WhyRow label={`+ Exercise (${localProfile.activity_hrs_per_week} h/wk)`} val={`+ ${fmtMl(calc.exercise)}`} />}
                  {calc.caffeine > 0 && <WhyRow label={`+ Caffeine (${localProfile.caffeine_mg_per_day} mg/day)`} val={`+ ${fmtMl(calc.caffeine)}`} />}
                  {localProfile.substances.map(s => (
                    <WhyRow key={s.id} label={`+ ${s.name} (${s.dose ?? s.defaultDose} ${s.unit})`} val={`+ ${fmtMl(subExtraMl(s))}`} />
                  ))}
                  {calc.adjust > 0 && <WhyRow label="+ Sex / age adjustment" val={`+ ${fmtMl(calc.adjust)}`} />}
                  <WhyRow label="Daily target" val={`${fmtMl(calc.total)} ≈ ${targetUnits} ${unitLabelPlural(localProfile)}`} total />
                </>
              )
            })()}
          </div>
        )}
      </div>

      {/* History Card */}
      <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] px-5 pt-[22px] pb-[18px] mb-3.5">
        <div className="text-[10px] font-bold tracking-[0.20em] uppercase text-white/40 mb-2">LAST 14 DAYS</div>
        <div className="py-1.5">
          {sparkHistory.length > 0
            ? <WaterSpark history={sparkHistory} targetUnits={targetUnits} unitVol={unitVol} />
            : <div className="h-[70px] flex items-center justify-center text-[12px] text-white/40">No logs yet.</div>
          }
        </div>
        <div className="mt-3.5">
          {last7.length === 0
            ? <div className="text-center text-[12px] text-white/40 py-3">No logs yet.</div>
            : last7.map(({ date, total_oz }) => {
                const d = new Date(date + 'T12:00:00')
                const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
                const lbl = `${dows[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`
                const dayCount = total_oz / unitVol
                const pct = Math.min(100, (dayCount / targetUnits) * 100)
                const hit = dayCount >= targetUnits
                return (
                  <div key={date} className="grid gap-2.5 py-2.5 items-center border-b border-white/[0.06] last:border-b-0 text-[13px]" style={{ gridTemplateColumns: '70px 1fr auto' }}>
                    <span className="text-[11px] text-white/40 font-mono">{lbl}</span>
                    <div className="h-2 bg-white/[0.04] rounded-[4px] overflow-hidden">
                      <div className="h-full rounded-[4px]" style={{
                        width: `${pct}%`,
                        background: hit ? 'linear-gradient(90deg, #7DD3FC, #6ee7b7)' : 'rgba(255,138,138,0.4)',
                      }} />
                    </div>
                    <span className="font-mono text-[12px] text-white/60 tabular-nums">{dayCount.toFixed(1)}/{targetUnits}</span>
                  </div>
                )
              })
          }
        </div>
      </div>

      {/* Settings gear */}
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-[38px] h-[38px] flex items-center justify-center bg-white/[0.04] border border-white/[0.06] rounded-[10px] text-white/60 cursor-pointer hover:bg-white/[0.08] hover:text-white transition-colors"
          aria-label="Settings"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>

      {/* Settings Modal */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/65"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-[480px] bg-[#111113] border border-white/[0.14] rounded-2xl p-[22px] max-h-[88vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="m-0 mb-3.5 text-[17px] font-bold">Settings</h3>

            <WSettingSection title="Profile">
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Weight">
                  <input type="number" step="0.5" min="20" max="300"
                    value={localProfile.weight_lbs ?? ''}
                    onChange={e => updateLocal({ weight_lbs: e.target.value ? parseFloat(e.target.value) : null })}
                    className={INPUT_CLS} />
                </WSettingField>
                <WSettingField label="Weight unit">
                  <WSegControl
                    value={localProfile.weight_unit}
                    options={[{ label: 'lb', value: 'lb' }, { label: 'kg', value: 'kg' }]}
                    onChange={v => updateLocal({ weight_unit: v as 'lb' | 'kg' })}
                  />
                </WSettingField>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Age">
                  <input type="number" min="13" max="100"
                    value={localProfile.age ?? ''}
                    onChange={e => updateLocal({ age: e.target.value ? parseInt(e.target.value) : null })}
                    className={INPUT_CLS} />
                </WSettingField>
                <WSettingField label="Sex">
                  <WSegControl
                    value={localProfile.sex ?? 'o'}
                    options={[{ label: 'M', value: 'm' }, { label: 'F', value: 'f' }, { label: 'Other', value: 'o' }]}
                    onChange={v => updateLocal({ sex: v as 'm' | 'f' | 'o' })}
                  />
                </WSettingField>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Height (ft)" hint="Improves calorie accuracy">
                  <input type="number" min="3" max="8"
                    value={localProfile.height_cm != null ? Math.floor(Math.round(localProfile.height_cm / 2.54) / 12) : ''}
                    onChange={e => {
                      const ft = parseInt(e.target.value) || 0
                      const existingIn = localProfile.height_cm != null
                        ? Math.round(localProfile.height_cm / 2.54) % 12
                        : 0
                      updateLocal({ height_cm: (ft * 12 + existingIn) * 2.54 })
                    }}
                    className={INPUT_CLS} />
                </WSettingField>
                <WSettingField label="Height (in)">
                  <input type="number" min="0" max="11"
                    value={localProfile.height_cm != null ? Math.round(localProfile.height_cm / 2.54) % 12 : ''}
                    onChange={e => {
                      const inches = parseInt(e.target.value) || 0
                      const existingFt = localProfile.height_cm != null
                        ? Math.floor(Math.round(localProfile.height_cm / 2.54) / 12)
                        : 0
                      updateLocal({ height_cm: (existingFt * 12 + inches) * 2.54 })
                    }}
                    className={INPUT_CLS} />
                </WSettingField>
              </div>
              <WSettingField label="Activity (training hours per week)">
                <input type="number" min="0" max="40" step="0.5"
                  value={localProfile.activity_hrs_per_week}
                  onChange={e => updateLocal({ activity_hrs_per_week: parseFloat(e.target.value) || 0 })}
                  className={INPUT_CLS} />
              </WSettingField>
            </WSettingSection>

            <WSettingSection title="Display">
              <WSettingField label="Show water as">
                <WSegControl
                  value={localProfile.water_unit}
                  options={[
                    { label: 'Bottles', value: 'bottle' },
                    { label: 'Glasses', value: 'glass' },
                    { label: 'oz', value: 'oz' },
                    { label: 'ml', value: 'ml' },
                  ]}
                  onChange={v => updateLocal({ water_unit: v as 'bottle' | 'glass' | 'oz' | 'ml' })}
                />
              </WSettingField>
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Bottle size (ml)">
                  <input type="number" min="100" max="2000" step="50"
                    value={localProfile.bottle_ml}
                    onChange={e => updateLocal({ bottle_ml: parseFloat(e.target.value) || 500 })}
                    className={INPUT_CLS} />
                </WSettingField>
                <WSettingField label="Glass size (ml)">
                  <input type="number" min="100" max="500" step="10"
                    value={localProfile.glass_ml}
                    onChange={e => updateLocal({ glass_ml: parseFloat(e.target.value) || 250 })}
                    className={INPUT_CLS} />
                </WSettingField>
              </div>
            </WSettingSection>

            <WSettingSection title="Caffeine">
              <WSettingField
                label="Average caffeine per day (mg)"
                hint="~1 cup of coffee = 95mg · espresso shot = 75mg · energy drink = 160mg. Above 200mg/day starts to add a small water requirement."
              >
                <input type="number" min="0" max="1000" step="10"
                  value={localProfile.caffeine_mg_per_day}
                  onChange={e => updateLocal({ caffeine_mg_per_day: parseFloat(e.target.value) || 0 })}
                  className={INPUT_CLS} />
              </WSettingField>
            </WSettingSection>

            <WSettingSection title="Stimulants & meds">
              <WSettingField
                label="Search to add"
                hint="Each substance bumps your daily water target. Includes ADHD stims, diuretics, decongestants, nicotine, alcohol, and a few others."
              >
                <div className="relative">
                  <input
                    type="text"
                    value={subSearch}
                    onChange={e => { setSubSearch(e.target.value); setShowSubResults(true) }}
                    onFocus={() => setShowSubResults(true)}
                    onBlur={() => setTimeout(() => setShowSubResults(false), 150)}
                    placeholder="Type a name (Adderall, Concerta, Lithium…)"
                    autoComplete="off"
                    className="w-full bg-black/[0.28] border border-white/[0.06] text-white text-[14px] px-3.5 py-[11px] rounded-[10px] outline-none focus:border-[rgba(110,231,183,0.40)]"
                  />
                  {showSubResults && subMatches.length > 0 && (
                    <div className="absolute top-[calc(100%+4px)] left-0 right-0 bg-[#111113] border border-white/[0.14] rounded-[10px] p-1 max-h-[240px] overflow-y-auto z-10">
                      {subMatches.map(s => (
                        <div key={s.id} onMouseDown={() => addSubstance(s.id)}
                          className="flex flex-col gap-0.5 px-3 py-[9px] rounded-[7px] cursor-pointer text-[13px] hover:bg-white/[0.05]">
                          <span className="text-white font-semibold">{s.name} <span className="text-[#6ee7b7]">+</span></span>
                          <span className="text-[10.5px] text-white/40 font-mono">
                            {s.cat} · {s.defaultDose} {s.unit} default → adds ~{fmtMl(s.defaultDose * s.mlPerUnit)}/day · {s.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </WSettingField>
              <div className="flex flex-col gap-1.5 mt-2.5">
                {localProfile.substances.length === 0
                  ? <div className="text-center text-[12px] text-white/40 italic py-3.5">No substances added.</div>
                  : localProfile.substances.map(s => (
                      <div key={s.id} className="flex items-center gap-2.5 flex-wrap px-3 py-2.5 bg-white/[0.025] border border-white/[0.06] rounded-[10px]">
                        <div className="flex-1 min-w-[140px]">
                          <div className="text-[13px] font-semibold text-white">{s.name}</div>
                          <div className="text-[11px] text-white/40 font-mono mt-0.5">+ {fmtMl(subExtraMl(s))} / day · {s.cat}</div>
                        </div>
                        <div className="inline-flex items-center gap-1.5 bg-black/30 border border-white/[0.06] rounded-[8px] px-2 py-1">
                          <input
                            type="number" min="0" step="0.5"
                            value={s.dose ?? s.defaultDose}
                            onChange={e => {
                              const dose = parseFloat(e.target.value) || 0
                              setLocalProfile(prev => ({
                                ...prev,
                                substances: prev.substances.map(x => x.id === s.id ? { ...x, dose } : x),
                              }))
                            }}
                            className="w-14 bg-transparent border-0 outline-none text-white text-[13px] font-semibold text-center tabular-nums"
                          />
                          <span className="text-[11px] text-white/40 font-mono whitespace-nowrap">{s.unit}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateLocal({ substances: localProfile.substances.filter(x => x.id !== s.id) })}
                          className="bg-transparent border-0 text-white/25 text-base cursor-pointer px-2 py-1 hover:text-[#ff8a8a] transition-colors"
                        >×</button>
                      </div>
                    ))
                }
              </div>
            </WSettingSection>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={savingSettings}
                className="flex-1 py-3.5 border-0 rounded-xl text-[#0a0a0b] text-[14px] font-bold cursor-pointer disabled:opacity-40"
                style={{
                  background: 'linear-gradient(180deg, #ffffff 0%, #e8e5dd 100%)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 4px 14px rgba(0,0,0,0.40)',
                }}
              >
                {savingSettings ? 'Saving...' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Caffeine Section ─────────────────────────────────────────────────────────

const CAFFEINE_PRESETS = [
  { source: 'Coffee', amount_mg: 90 },
  { source: 'Pre-workout', amount_mg: 200 },
  { source: 'Energy drink', amount_mg: 150 },
  { source: 'Espresso', amount_mg: 60 },
] as const

function CaffeineSection({
  initialCaffeine,
  today,
}: {
  initialCaffeine: CaffeineLog[]
  today: string
}) {
  const { data: caffeineLogs } = useCaffeineLogs(today, initialCaffeine)
  const logCaffeine = useLogCaffeine(today)
  const deleteCaffeine = useDeleteCaffeineLog(today)

  const totalCaffeine = caffeineLogs?.reduce((sum, l) => sum + l.amount_mg, 0) ?? 0
  const overLimit = totalCaffeine > 400

  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Caffeine
      </h2>
      <div className="rounded-xl bg-zinc-900 p-4">
        <div className="mb-3 flex items-end gap-2">
          <p className={`text-3xl font-bold ${overLimit ? 'text-red-400' : 'text-white'}`}>
            {Math.round(totalCaffeine)}
          </p>
          <p className="mb-0.5 text-lg text-zinc-400">mg</p>
          {overLimit && (
            <span className="mb-0.5 ml-auto text-xs font-semibold text-red-400">
              Over 400mg
            </span>
          )}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {CAFFEINE_PRESETS.map((preset) => (
            <button
              key={preset.source}
              onClick={() =>
                logCaffeine.mutate({ source: preset.source, amount_mg: preset.amount_mg })
              }
              disabled={logCaffeine.isPending}
              className="rounded-full bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white active:bg-zinc-700 disabled:opacity-50"
            >
              {preset.source}{' '}
              <span className="text-zinc-400">{preset.amount_mg}mg</span>
            </button>
          ))}
        </div>

        {caffeineLogs && caffeineLogs.length > 0 && (
          <div className="space-y-1.5">
            {[...caffeineLogs].reverse().map((log) => (
              <div key={log.id} className="flex items-center gap-3">
                <span className="w-16 text-xs text-zinc-500">{formatTime(log.logged_at)}</span>
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
        )}
      </div>
    </section>
  )
}

// ─── Food Section ────────────────────────────────────────────────────────────

function MacroBar({ value, target, color }: { value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

function MealEditSheet({
  meal,
  onSave,
  onClose,
}: {
  meal: FoodLog
  onSave: (updates: Partial<FoodLog>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(meal.item_name)
  const [calories, setCalories] = useState(String(meal.calories ?? ''))
  const [protein, setProtein] = useState(String(meal.protein_g ?? ''))
  const [carbs, setCarbs] = useState(String(meal.carbs_g ?? ''))
  const [notes, setNotes] = useState(meal.notes ?? '')

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {meal.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meal.photo_url} alt={meal.item_name} className="w-full h-40 object-cover rounded-xl" />
        )}
        <input
          className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
          placeholder="Meal name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Cal</label>
            <input type="number" min="0" className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={calories} onChange={e => setCalories(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Protein (g)</label>
            <input type="number" min="0" className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={protein} onChange={e => setProtein(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Carbs (g)</label>
            <input type="number" min="0" className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={carbs} onChange={e => setCarbs(e.target.value)} />
          </div>
        </div>
        <textarea
          className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40 resize-none"
          placeholder="Notes (optional)"
          rows={2}
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/[0.12] py-3 text-sm font-semibold text-zinc-400">
            Cancel
          </button>
          <button
            onClick={() => {
              onSave({
                item_name: name.trim() || meal.item_name,
                calories: calories ? parseInt(calories) : meal.calories,
                protein_g: protein ? parseFloat(protein) : meal.protein_g,
                carbs_g: carbs ? parseFloat(carbs) : meal.carbs_g,
                notes: notes.trim() || null,
              })
            }}
            className="flex-1 rounded-xl py-3 text-sm font-bold text-[#0a0a0b]"
            style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function CalorieTargetSheet({
  profile,
  onSave,
  onClose,
}: {
  profile: { target_weight_lbs?: number | null; cut_pace?: string | null; target_reasoning?: string | null; daily_calorie_target?: number | null; daily_protein_target_g?: number | null; daily_carbs_target_g?: number | null }
  onSave: () => void
  onClose: () => void
}) {
  const [targetWeight, setTargetWeight] = useState(String(profile.target_weight_lbs ?? ''))
  const [pace, setPace] = useState<'slow' | 'moderate' | 'aggressive'>((profile.cut_pace as 'slow' | 'moderate' | 'aggressive') ?? 'moderate')
  const updateProfile = useUpdateHealthProfile()
  const calcTarget = useCalculateCalorieTarget()
  const [result, setResult] = useState<{ daily_calories: number; protein_g: number; carbs_g: number; reasoning: string } | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleCalculate() {
    const w = parseFloat(targetWeight)
    if (!w || w <= 0) return
    await updateProfile.mutateAsync({ target_weight_lbs: w, cut_pace: pace } as Parameters<typeof updateProfile.mutateAsync>[0])
    const res = await calcTarget.mutateAsync()
    setResult(res)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-white">Set calorie target</h3>
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Target weight (lbs)</label>
          <input
            type="number" min="80" max="500" step="0.5"
            className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
            placeholder="e.g. 165"
            value={targetWeight}
            onChange={e => setTargetWeight(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Pace</label>
          <div className="flex gap-1 rounded-[10px] bg-white/[0.04] border border-white/[0.06] p-[3px]">
            {(['slow', 'moderate', 'aggressive'] as const).map(p => (
              <button key={p} onClick={() => setPace(p)} className={`flex-1 rounded-[7px] py-2.5 text-xs font-semibold capitalize transition-colors ${pace === p ? 'text-[#0a0a0b]' : 'text-white/40'}`}
                style={pace === p ? { background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' } : {}}>
                {p}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-zinc-600">
            {pace === 'slow' ? '0.5 lb/week — gentle deficit' : pace === 'moderate' ? '1 lb/week — standard cut' : '1.5 lb/week — aggressive cut'}
          </p>
        </div>
        {result && (
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] p-4 space-y-2">
            <p className="text-sm font-bold text-white">{result.daily_calories.toLocaleString()} cal · {result.protein_g}g P · {result.carbs_g}g C</p>
            <p className="text-xs text-zinc-400 leading-relaxed">{result.reasoning}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/[0.12] py-3 text-sm font-semibold text-zinc-400">
            Cancel
          </button>
          {!result ? (
            <button
              onClick={handleCalculate}
              disabled={!targetWeight || calcTarget.isPending || updateProfile.isPending}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-[#0a0a0b] disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
            >
              {calcTarget.isPending ? 'Calculating…' : 'Calculate'}
            </button>
          ) : (
            <button
              onClick={() => {
                setSaved(true)
                onSave()
              }}
              disabled={saved}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-[#0a0a0b] disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
            >
              Save target
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function FoodSection({ profile }: { profile: ReturnType<typeof useHealthProfile>['data'] }) {
  const { data: meals, isLoading } = useFoodLogs()
  const logFood = useLogFood()
  const updateMeal = useUpdateFoodLog()
  const deleteMeal = useDeleteFoodLog()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [editingMeal, setEditingMeal] = useState<FoodLog | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [targetSheetOpen, setTargetSheetOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const updateProfile = useUpdateHealthProfile()

  const today = (() => {
    const now = new Date()
    if (now.getHours() < 6) {
      const d = new Date(now)
      d.setDate(d.getDate() - 1)
      return d.toISOString().split('T')[0]
    }
    return now.toISOString().split('T')[0]
  })()

  const totals = (meals ?? []).reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories ?? 0),
      protein_g: acc.protein_g + (Number(m.protein_g) ?? 0),
      carbs_g: acc.carbs_g + (Number(m.carbs_g) ?? 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0 },
  )

  const hasTarget = !!profile?.daily_calorie_target

  const handlePhoto = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    setDescription('')
  }, [])

  const submitPendingPhoto = useCallback(async () => {
    if (!pendingFile) return
    setUploading(true)
    setPendingPreview(null)
    setPendingFile(null)
    try {
      const resized = await resizeImage(pendingFile, 1024)
      const fd = new FormData()
      fd.append('photo', resized, 'meal.jpg')
      if (description.trim()) fd.append('description', description.trim())
      await logFood.mutateAsync(fd)
    } catch (err) {
      console.error('Food log error:', err)
    } finally {
      setUploading(false)
      setDescription('')
    }
  }, [pendingFile, description, logFood])

  return (
    <section>
      <div className="flex items-center gap-4 mb-3.5">
        <div className="flex-1 h-px bg-white/[0.10]" />
        <span className="text-[11px] font-semibold tracking-[0.22em] text-white/85">FOOD</span>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>

      <div className="rounded-xl bg-zinc-900 p-4 space-y-3">
        {/* Totals row */}
        {hasTarget ? (
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Calories</span>
                <span className="font-mono text-zinc-300 tabular-nums">{totals.calories.toLocaleString()} / {profile!.daily_calorie_target!.toLocaleString()}</span>
              </div>
              <MacroBar value={totals.calories} target={profile!.daily_calorie_target!} color="#6ee7b7" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Protein</span>
                <span className="font-mono text-zinc-300 tabular-nums">{Math.round(totals.protein_g)}g / {profile!.daily_protein_target_g!}g</span>
              </div>
              <MacroBar value={totals.protein_g} target={profile!.daily_protein_target_g!} color="#7B5BB0" />
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-zinc-400">Carbs</span>
                <span className="font-mono text-zinc-300 tabular-nums">{Math.round(totals.carbs_g)}g / {profile!.daily_carbs_target_g!}g</span>
              </div>
              <MacroBar value={totals.carbs_g} target={profile!.daily_carbs_target_g!} color="#F2C063" />
            </div>
            <p className="text-[10px] text-zinc-600">{(meals ?? []).length} meal{(meals ?? []).length !== 1 ? 's' : ''} today</p>
          </div>
        ) : (
          <div className="space-y-1">
            <p className="text-sm text-zinc-300">
              {totals.calories.toLocaleString()} cal · {Math.round(totals.protein_g)}g P · {Math.round(totals.carbs_g)}g C · {(meals ?? []).length} meal{(meals ?? []).length !== 1 ? 's' : ''}
            </p>
            <button onClick={() => setTargetSheetOpen(true)} className="text-xs text-zinc-500 underline underline-offset-2">
              Set a calorie target
            </button>
          </div>
        )}

        {/* Add food button */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhoto}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full rounded-xl border border-white/[0.12] py-2.5 text-sm font-semibold text-white disabled:opacity-50 hover:bg-white/[0.04] transition-colors"
          >
            {uploading ? 'Estimating…' : '+ Add food'}
          </button>
        </div>

        {/* Meal list */}
        {!isLoading && (meals ?? []).length > 0 && (
          <div className="space-y-2 pt-1">
            {(meals ?? []).map(meal => (
              <div key={meal.id}>
                {confirmDeleteId === meal.id ? (
                  <div className="flex items-center justify-between gap-3 rounded-[10px] bg-white/[0.035] px-3 py-2.5">
                    <span className="text-xs text-zinc-400">Delete this meal?</span>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300">Cancel</button>
                      <button
                        onClick={async () => {
                          await deleteMeal.mutateAsync({ id: meal.id, date: today })
                          setConfirmDeleteId(null)
                        }}
                        className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="flex w-full items-center gap-3 rounded-[10px] bg-white/[0.035] px-3 py-2.5 cursor-pointer hover:bg-white/[0.05] transition-colors"
                    onClick={() => setEditingMeal(meal)}
                  >
                    {meal.photo_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={meal.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{meal.item_name}</p>
                      <p className="text-[10px] text-zinc-500">
                        {Math.round(Number(meal.protein_g))}g P · {Math.round(Number(meal.carbs_g))}g C · {new Date(meal.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-white">{meal.calories?.toLocaleString()} cal</span>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(meal.id) }}
                        className="text-sm text-zinc-600 hover:text-red-400 transition-colors px-1"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* View history */}
        <div className="flex justify-between items-center pt-1">
          {hasTarget && (
            <button onClick={() => setTargetSheetOpen(true)} className="text-xs text-zinc-600 underline underline-offset-2">
              Edit target
            </button>
          )}
          <a href="/health/food" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            View history →
          </a>
        </div>
      </div>

      {editingMeal && (
        <MealEditSheet
          meal={editingMeal}
          onSave={async (updates) => {
            await updateMeal.mutateAsync({ id: editingMeal.id, date: today, updates })
            setEditingMeal(null)
          }}
          onClose={() => setEditingMeal(null)}
        />
      )}

      {targetSheetOpen && (
        <CalorieTargetSheet
          profile={profile ?? {}}
          onSave={() => setTargetSheetOpen(false)}
          onClose={() => setTargetSheetOpen(false)}
        />
      )}

      {pendingPreview && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={() => { setPendingPreview(null); setPendingFile(null); setDescription('') }}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pendingPreview} alt="Meal preview" className="w-full h-48 object-cover rounded-xl" />
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">What is this? <span className="text-zinc-600">(optional)</span></p>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. chicken breast and white rice, about 6oz"
                rows={2}
                className="w-full resize-none rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={submitPendingPhoto}
                className="flex-1 h-12 rounded-xl text-sm font-semibold text-black active:opacity-80"
                style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55),0 4px 14px rgba(0,0,0,0.40)' }}
              >
                Log it
              </button>
              <button
                onClick={() => { setPendingPreview(null); setPendingFile(null); setDescription(''); fileInputRef.current?.click() }}
                className="h-12 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-semibold text-white active:opacity-80"
              >
                Retake
              </button>
              <button
                onClick={() => { setPendingPreview(null); setPendingFile(null); setDescription('') }}
                className="h-12 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-semibold text-zinc-400 active:opacity-80"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Root Component ───────────────────────────────────────────────────────────

function HealthCoach() {
  const [text, setText] = useState('')
  const [streaming, setStreaming] = useState(false)

  async function run() {
    setStreaming(true)
    setText('')
    try {
      const res = await fetch('/api/health/coach', { method: 'POST' })
      if (!res.ok || !res.body) {
        setText('Something went wrong. Try again.')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        setText(prev => prev + decoder.decode(value))
      }
    } finally {
      setStreaming(false)
    }
  }

  return (
    <section>
      <button
        onClick={run}
        disabled={streaming}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-zinc-300 disabled:opacity-60 active:opacity-80"
      >
        {streaming ? 'Thinking…' : 'Get coach feedback'}
      </button>
      {text && (
        <p className="mt-3 text-sm leading-relaxed text-zinc-300">{text}</p>
      )}
    </section>
  )
}

export default function HealthClient({
  supplements,
  todayLogs,
  todayWater,
  todayCaffeine,
  profile,
  ouraData,
  whoopData,
  hasOura,
  hasWhoop,
  today,
}: Props) {
  const { data: profileData } = useHealthProfile(profile)

  return (
    <main className="min-h-screen space-y-5 px-4 pb-24 pt-14">
      <h1 className="text-xl font-bold text-white">Health</h1>
      <HealthCoach />
      <WearablesSection
        hasOura={hasOura}
        hasWhoop={hasWhoop}
        initialOura={ouraData}
        initialWhoop={whoopData}
        today={today}
      />
      <FoodSection profile={profileData} />
      <StackTracker initialSupplements={supplements} initialLogs={todayLogs} />
      <WaterSection
        initialWater={todayWater}
        initialCaffeine={todayCaffeine}
        initialProfile={profile}
        today={today}
      />
      <CaffeineSection initialCaffeine={todayCaffeine} today={today} />
      <DebloatSection today={today} />
    </main>
  )
}
