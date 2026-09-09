'use client'

import { useState, useEffect, useRef, type ReactNode, type InputHTMLAttributes, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import Link from 'next/link'
import {
  useSupplements,
  useSupplementLogs,
  useWaterLogs,
  useCaffeineLogs,
  useHealthProfile,
  useWaterHistory,
  useOuraData,
  useAppleHealth,
} from '@/features/health/queries'
import { useQueryClient } from '@tanstack/react-query'
import { useHashScroll } from '@/lib/useHashScroll'
import { useLockBodyScroll } from '@/lib/useLockBodyScroll'
import {
  useCreateSupplement,
  useUpdateSupplement,
  useDeleteSupplement,
  useLogSupplementDose,
  useUnlogSupplementDose,
  useReorderSupplements,
  useLogWater,
  useDeleteWaterLog,
  useUpdateHealthProfile,
  useLogCaffeine,
  useDeleteCaffeineLog,
} from '@/features/health/mutations'
import { useFoodLogs } from '@/features/food/queries'
import { useLogFood, useUpdateFoodLog, useDeleteFoodLog, useCalculateCalorieTarget } from '@/features/food/mutations'
import { resizeImage } from '@/features/food/resize'
import { checkNoApiKey, checkAiLimit, noApiKeyMessage, NoApiKeyClientError, AiLimitClientError, type KeyProvider } from '@/lib/apiKeyError'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'
import AiLimitNotice from '@/components/AiLimitNotice'
import ChatText from '@/components/ChatText'
import { FoodWizardSheet, BarcodeFlow, FrequentsRow } from './FoodEntry'
import { MealBuilderSheet } from './MealBuilder'
import { PhotoMealCard } from './PhotoMealCard'
import FoodEmojiPicker from './FoodEmojiPicker'
import { foodEmoji } from '@/features/food/foodEmoji'
import { FoodCoachSection } from './FoodCoachSection'
import type { FoodLog, SavedMeal, UserIngredient } from '@/features/food/types'
import type {
  Supplement,
  SupplementLog,
  WaterLog,
  CaffeineLog,
  HealthProfile,
  SubstanceEntry,
  OuraData,
  TimeSlot,
} from '@/features/health/types'
import { WEARABLE_LABEL, type WearableProvider } from '@/features/health/wearableProvider'
import {
  STACK_WINDOWS,
  searchSupplements,
  type SupplementDbEntry,
  type StackWindow,
} from '@/features/health/supplementDb'
import { SUBSTANCE_DB } from '@/features/health/substanceDb'
import DebloatSection from './DebloatSection'
import AppleHealthCard from './AppleHealthCard'
import { rolledDate } from '@/features/food/date'
import {
  currentEnergyFromLogs,
  toEnergyDayHour,
  energyColor as energyColorShared,
  energyLabel as energyLabelShared,
  type WorkoutPoint,
  type MealPoint,
} from '@/features/health/energyModel'

interface Props {
  supplements: Supplement[]
  todayLogs: SupplementLog[]
  todayWater: WaterLog[]
  todayCaffeine: CaffeineLog[]
  profile: HealthProfile | null
  ouraData: OuraData | null
  wearableProvider: WearableProvider | null
  today: string
  workouts: WorkoutPoint[]
  meals: MealPoint[]
  typicalWakeHour: number | null
  savedMeals: SavedMeal[]
  userIngredients: UserIngredient[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-zinc-400'
  if (score >= 70) return 'text-green-400'
  if (score >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function fmtInt(n: number | null | undefined): string {
  return n == null ? '--' : Math.round(n).toLocaleString('en-US')
}

// "6h 55m" from seconds. Shown in the Sleep slot for providers that expose no
// sleep score (Fitbit), where a derived number would contradict the one in the
// user's own app.
function fmtSleepDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function relTimeShort(iso: string | null | undefined): string {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function getStackDate(): string {
  return rolledDate()
}

// ─── Wearable switcher (Health → Settings → Wearables) ──────────────────────
// Connecting one provider replaces the other server-side (the callbacks delete
// the sibling token), so these are plain links into each OAuth flow.

function WearableSwitchRows() {
  const [busy, setBusy] = useState(false)
  const disconnect = async () => {
    setBusy(true)
    await fetch('/api/health/wearables/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'all' }),
    }).catch(() => {})
    window.location.href = '/health'
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-[11px] text-zinc-500">Your main wearable. Connecting one replaces the others.</p>
      <div className="grid grid-cols-3 gap-2">
        <a href="/api/health/oura/connect" className="rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-semibold text-white active:opacity-70">Use Oura</a>
        <a href="/api/health/whoop/connect" className="rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-semibold text-white active:opacity-70">Use WHOOP</a>
        <a href="/api/health/fitbit/connect" className="rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-semibold text-white active:opacity-70">Use Fitbit</a>
      </div>
      <button onClick={disconnect} disabled={busy} className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-red-400/80 active:opacity-60 disabled:opacity-50">
        {busy ? 'Disconnecting…' : 'Disconnect wearable'}
      </button>
    </div>
  )
}

// ─── Wearables Section ──────────────────────────────────────────────────────

function WearablesSection({
  wearableProvider,
  initialOura,
  today,
}: {
  wearableProvider: WearableProvider | null
  initialOura: OuraData | null
  today: string
}) {
  // "oura" naming below is historical: WHOOP data is normalized into the same
  // OuraData shape by whoopSync, so one card + one query serve both providers.
  const hasOura = wearableProvider != null
  const providerLabel = wearableProvider ? WEARABLE_LABEL[wearableProvider].card : 'Wearable'
  const { data: oura, isPending: ouraPending } = useOuraData(today, hasOura, initialOura)
  // Fitbit's Web API has no sleep/readiness score; fitbitSync derives both and
  // flags the row so the card can say so instead of passing them off as device readings.
  const estimated = !!oura?.fitbit?.scores_estimated
  const { data: apple } = useAppleHealth(today)
  const { data: profile } = useHealthProfile()
  // Per-user card visibility (Health → Settings → Wearables). Default on.
  const showOura = profile?.show_oura ?? true
  const showAppleWatch = profile?.show_apple_watch ?? true
  const appleLatest = apple?.latest ?? null
  // Only treat Apple data as live if it synced within the last few days. A
  // stale one-off sync shouldn't leave a dead card lingering (or feed the Oura
  // steps fallback) forever.
  const appleFresh =
    !!appleLatest?.date &&
    (new Date(today).getTime() - new Date(appleLatest.date).getTime()) / 86_400_000 <= 3
  const hasApple = appleFresh && (apple?.daysOfData ?? 0) > 0
  const appleVisible = showAppleWatch && hasApple
  // Steps for the Oura card: prefer a source whose count is definitely TODAY's
  // (Apple syncs live from the phone; Oura only finalizes today in the evening),
  // else fall back to the latest available count and label it "yesterday".
  const appleToday = hasApple && appleLatest?.date === today ? appleLatest.steps ?? null : null
  const ouraStepsToday = oura?.activity?.steps_day === today ? oura?.activity?.steps ?? null : null
  const stepsToday = appleToday ?? ouraStepsToday
  const stepsValue =
    stepsToday ?? oura?.activity?.steps ?? (hasApple ? appleLatest?.steps ?? null : null)
  const stepsAreToday = stepsToday != null
  const qc = useQueryClient()
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!ouraPending) {
      setLastUpdated(new Date())
    }
  }, [oura, ouraPending])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    // Force a fresh Oura pull (bypass the 15-min cache) so the button actually
    // re-fetches Oura's latest cloud value rather than serving cached data.
    if (hasOura) {
      await fetch('/api/health/oura/data?force=1')
        .then(r => (r.ok ? r.json() : null))
        .then(d => qc.setQueryData(['health', 'oura', today], d))
        .catch(() => {})
    }
    setLastUpdated(new Date())
    setRefreshing(false)
  }, [hasOura, qc, today])

  // Both cards hidden (or nothing to show) → drop the whole section, header too.
  if (!showOura && !appleVisible) return null

  return (
    <section id="wearables" className="scroll-mt-6">
      <div className="flex items-center gap-4 mb-3.5">
        <div className="flex-1 h-px bg-white/[0.10]" />
        <span className="text-[11px] font-semibold tracking-[0.22em] text-white/85">WEARABLES</span>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>
      <div className="space-y-3">
        {showOura && (
        <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] p-4">
          <p className="mb-3 text-xs font-medium text-zinc-500">{providerLabel}</p>
          {!hasOura ? (
            <div className="grid grid-cols-3 gap-2">
              <a
                href="/api/health/oura/connect"
                className="block rounded-lg bg-white px-2 py-2 text-center text-xs font-semibold text-black"
              >
                Oura Ring
              </a>
              <a
                href="/api/health/whoop/connect"
                className="block rounded-lg bg-white px-2 py-2 text-center text-xs font-semibold text-black"
              >
                WHOOP
              </a>
              <a
                href="/api/health/fitbit/connect"
                className="block rounded-lg bg-white px-2 py-2 text-center text-xs font-semibold text-black"
              >
                Fitbit
              </a>
            </div>
          ) : ouraPending ? (
            <p className="text-xs text-zinc-500">Syncing...</p>
          ) : !oura ? (
            <p className="text-xs text-zinc-500">No data yet</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Readiness</p>
                <p className={`text-3xl font-bold ${scoreColor(oura.readiness?.score)}`}>
                  {oura.readiness?.score ?? '--'}
                  {estimated && oura.readiness?.score != null && (
                    <span className="ml-1.5 align-middle text-[10px] font-normal text-zinc-600">est.</span>
                  )}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Sleep</p>
                  <p className="text-sm font-semibold text-white">
                    {oura.sleep?.score ?? fmtSleepDuration(oura.sleep?.total_sleep_duration) ?? '--'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Steps</p>
                  <p className="text-sm font-semibold text-white">
                    {fmtInt(stepsValue)}
                    {!stepsAreToday && stepsValue != null && (
                      <span className="ml-1.5 text-[10px] font-normal text-zinc-600">yesterday</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
        )}

        {/* Apple Watch — synced within the last few days AND not hidden in settings */}
        {appleVisible && (
          <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-500">Apple Watch</p>
              {apple?.lastSync && (
                <span className="text-[10px] text-zinc-600">{relTimeShort(apple.lastSync)}</span>
              )}
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Steps</p>
                <p className="text-3xl font-bold text-white">{fmtInt(appleLatest?.steps)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Active cal</p>
                  <p className="text-sm font-semibold text-white">{fmtInt(appleLatest?.active_calories)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">VO₂ Max</p>
                  <p className="text-sm font-semibold text-white">
                    {appleLatest?.vo2_max != null ? appleLatest.vo2_max.toFixed(1) : '--'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Freshness footer */}
      {showOura && hasOura && (
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-[11px] text-zinc-600">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : ouraPending ? 'Syncing...' : ''}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh wearable data"
            className="flex items-center justify-center w-7 h-7 rounded-lg text-zinc-500 hover:text-white hover:bg-white/8 transition-colors disabled:opacity-40"
          >
            <svg
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={refreshing ? 'animate-spin' : ''}
            >
              <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5a5.5 5.5 0 0 1 3.9 1.6L13.5 5.5" />
              <path d="M13.5 2.5v3h-3" />
            </svg>
          </button>
        </div>
      )}
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
        aria-label="Mark taken"
        className={[
          'w-7 h-7 rounded-full border-2 flex items-center justify-center text-sm font-medium transition-all duration-200',
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

// One draggable row in the supplement reorder sheet — vertical drag via the ⠿ handle.
function SupplementReorderRow({ supplement }: { supplement: Supplement }) {
  const controls = useDragControls()
  const meta = [supplement.dose, supplement.notes].filter(Boolean).join(' · ')
  return (
    <Reorder.Item
      value={supplement}
      as="div"
      dragListener={false}
      dragControls={controls}
      whileDrag={{ scale: 1.03, backgroundColor: 'rgba(29,158,117,0.10)' }}
      className="flex items-center gap-3 px-3 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] select-none"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white/85 truncate">{supplement.name}</div>
        {meta && <div className="text-[11px] text-white/35 truncate mt-0.5">{meta}</div>}
      </div>
      <span
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab text-white/30 text-lg leading-none px-2 -mr-1"
        style={{ touchAction: 'none' }}
        aria-label="Drag to reorder"
      >⠿</span>
    </Reorder.Item>
  )
}

// Bottom-sheet reorder menu for one stack window — a vertical drag list.
function SupplementReorderSheet({ title, items, onClose, onSave }: {
  title: string
  items: Supplement[]
  onClose: () => void
  onSave: (orderedIds: string[]) => void
}) {
  const [order, setOrder] = useState(items)
  const done = () => { onSave(order.map(s => s.id)); onClose() }
  useLockBodyScroll(true)
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      onClick={done}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-4 max-h-[80vh] overflow-y-auto overscroll-contain"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-white">Reorder {title}</h3>
            <p className="text-[11px] text-white/35 mt-0.5">Drag the ⠿ handle</p>
          </div>
          <button onClick={done} className="text-sm font-semibold text-[#1D9E75] active:opacity-60 px-2 py-1">Done</button>
        </div>
        <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="space-y-2">
          {order.map(s => <SupplementReorderRow key={s.id} supplement={s} />)}
        </Reorder.Group>
      </div>
    </div>,
    document.body,
  )
}

function StackWindowSection({
  win,
  supplements,
  logs,
  confirmDeleteId,
  deletePending,
  onToggle,
  onConfirmDelete,
  onCancelDelete,
  onDelete,
  onToggleLow,
  onUpdateName,
  onUpdateMeta,
  onReorder,
}: {
  win: StackWindow
  supplements: Supplement[]
  logs: SupplementLog[]
  confirmDeleteId: string | null
  deletePending: boolean
  onToggle: (s: Supplement) => void
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
  onDelete: (id: string) => void
  onToggleLow: (s: Supplement) => void
  onUpdateName: (id: string, name: string) => void
  onUpdateMeta: (id: string, dose: string, notes: string) => void
  onReorder: (winKey: TimeSlot, orderedIds: string[]) => void
}) {
  const [reordering, setReordering] = useState(false)
  if (supplements.length === 0) return null
  const currentHour = new Date().getHours() + new Date().getMinutes() / 60
  const isPastCutoff = win.cutoffHour != null && currentHour > win.cutoffHour

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-white/[0.04]">
        <span className="text-base">{win.icon}</span>
        <span className="text-sm font-bold text-white">{win.title}</span>
        <span className="text-[11px] text-zinc-500 font-medium">{win.time}</span>
        {supplements.length > 1 && (
          <button
            onClick={() => setReordering(true)}
            className="ml-auto text-[11px] text-zinc-500 font-mono active:opacity-50"
          >
            reorder
          </button>
        )}
      </div>
      {reordering && (
        <SupplementReorderSheet
          title={win.title}
          items={supplements}
          onClose={() => setReordering(false)}
          onSave={(ids) => onReorder(win.key, ids)}
        />
      )}
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
  const [suggestNoKeyProvider, setSuggestNoKeyProvider] = useState<KeyProvider | null>(null)
  const [suggestAiLimit, setSuggestAiLimit] = useState(false)
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
        if (!res.ok) {
          const noKey = await checkNoApiKey(res)
          if (noKey) setSuggestNoKeyProvider(noKey.provider)
          const limit = await checkAiLimit(res)
          if (limit) setSuggestAiLimit(true)
          return
        }
        setSuggestNoKeyProvider(null)
        setSuggestAiLimit(false)
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
                setSuggestNoKeyProvider(null)
                setSuggestAiLimit(false)
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
              <div className="absolute top-[calc(100%+6px)] left-0 w-[max(100%,320px)] bg-[rgba(15,15,18,0.96)] border border-white/[0.12] rounded-xl max-h-72 overflow-y-auto backdrop-blur-xl shadow-[0_16px_40px_rgba(0,0,0,0.65)] z-[200] p-1.5">
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
        {suggestNoKeyProvider && <NoApiKeyNotice provider={suggestNoKeyProvider} className="mt-1.5" />}
        {suggestAiLimit && <AiLimitNotice className="mt-1.5" />}
      </div>
    </div>
  )
}

function StackTracker({
  initialSupplements,
  initialLogs,
  today,
}: {
  initialSupplements: Supplement[]
  initialLogs: SupplementLog[]
  today: string
}) {
  // Start with the server's date so the query key matches initialLogs.
  // On mount, immediately correct to the browser's local date (server may
  // use UTC which can be a day ahead for US timezones after ~5pm).
  // On visibility restore (bfcache, tab switch) repeat so yesterday's logs
  // never bleed into today.
  const [stackDate, setStackDate] = useState(() => today)
  useEffect(() => {
    // Correct on first mount
    setStackDate(rolledDate())
    // Re-correct whenever the page becomes visible (handles bfcache)
    const update = () => {
      if (document.visibilityState === 'visible') setStackDate(rolledDate())
    }
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  const { data: supplements } = useSupplements(initialSupplements)
  const { data: logs } = useSupplementLogs(stackDate, initialLogs)
  const logDose = useLogSupplementDose(stackDate)
  const unlogDose = useUnlogSupplementDose(stackDate)
  const deleteSupplement = useDeleteSupplement()
  const createSupplement = useCreateSupplement()
  const updateSupplement = useUpdateSupplement()
  const reorderSupplements = useReorderSupplements()

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
  const allTaken = totalSlots > 0 && takenCount === totalSlots

  function handleToggle(s: Supplement) {
    const slot = (s.times[0] as TimeSlot | undefined) ?? 'anytime'
    const existingLog = allLogs.find(l => l.supplement_id === s.id && l.time_slot === slot)
    if (existingLog) {
      // Optimistic row whose real id hasn't landed yet — can't delete it server-side.
      if (existingLog.id.startsWith('optimistic-')) return
      unlogDose.mutate(existingLog.id)
    } else {
      logDose.mutate({ supplement_id: s.id, time_slot: slot })
    }
  }

  function handleLogAll() {
    if (allTaken) {
      allLogs.forEach(l => {
        if (!l.id.startsWith('optimistic-')) unlogDose.mutate(l.id)
      })
    } else {
      allSupplements.forEach(s => {
        const slot = (s.times[0] as TimeSlot | undefined) ?? 'anytime'
        const alreadyLogged = allLogs.some(l => l.supplement_id === s.id && l.time_slot === slot)
        if (!alreadyLogged) logDose.mutate({ supplement_id: s.id, time_slot: slot })
      })
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

  // Reorder within one window, but persist the FULL global order so order_index
  // stays contiguous and the other windows keep their relative order.
  function handleReorder(winKey: TimeSlot, orderedIds: string[]) {
    const fullIds = STACK_WINDOWS.flatMap(w =>
      w.key === winKey ? orderedIds : (grouped.get(w.key) ?? []).map(s => s.id)
    )
    reorderSupplements.mutate(fullIds)
  }

  const deletePending = deleteSupplement.isPending

  return (
    <section id="supplements" className="relative scroll-mt-6" style={{ zIndex: 2, isolation: 'isolate' }}>
      <StackTicker supplements={allSupplements} logs={allLogs} />

      {/* Header */}
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-zinc-500 mb-1.5">
            Daily stack
          </div>
          <div className="text-2xl font-bold tracking-tight text-white leading-tight">
            Tap each as you take it
          </div>
          <div className="font-mono text-xs text-zinc-500 mt-1.5 tabular-nums">
            {totalSlots === 0
              ? '— / — taken today · resets at 3 AM'
              : `${takenCount} / ${totalSlots} taken today · resets at 3 AM`}
          </div>
        </div>
        {totalSlots > 0 && (
          <button
            onClick={handleLogAll}
            className="flex-none rounded-[8px] border px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap"
            style={{ color: '#dffbe9', borderColor: 'rgba(74,222,128,0.4)', background: 'radial-gradient(120% 150% at 50% 0%, rgba(74,222,128,0.18), transparent)' }}
          >
            {allTaken ? '↺ Reset' : 'Log all'}
          </button>
        )}
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
          onReorder={handleReorder}
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
  water_unit: 'bottle' | 'glass'
  bottle_ml: number
  glass_ml: number
  weight_unit: 'lb' | 'kg'
  substances: SubstanceEntry[]
  daily_water_target_oz: number | null
  show_oura: boolean
  show_apple_watch: boolean
}

function defaultWaterProfile(): WaterProfile {
  return {
    weight_lbs: null, age: null, sex: null, height_cm: null,
    activity_hrs_per_week: 0, caffeine_mg_per_day: 200,
    water_unit: 'bottle', bottle_ml: 500, glass_ml: 250,
    weight_unit: 'lb', substances: [], daily_water_target_oz: null,
    show_oura: true, show_apple_watch: true,
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
    // Legacy profiles may still carry 'oz'/'ml' — collapse them to bottle.
    water_unit: p.water_unit === 'glass' ? 'glass' : p.water_unit === 'bottle' ? 'bottle' : d.water_unit,
    bottle_ml: p.bottle_ml ?? d.bottle_ml,
    glass_ml: p.glass_ml ?? d.glass_ml,
    weight_unit: p.weight_unit ?? d.weight_unit,
    substances: p.substances ?? d.substances,
    daily_water_target_oz: p.daily_water_target_oz ?? d.daily_water_target_oz,
    show_oura: p.show_oura ?? d.show_oura,
    show_apple_watch: p.show_apple_watch ?? d.show_apple_watch,
  }
}

function subExtraMl(s: SubstanceEntry): number {
  const dose = s.dose ?? s.defaultDose ?? 0
  return Math.max(0, dose * (s.mlPerUnit ?? 0))
}

function computeTarget(p: WaterProfile, todayCaffeineMg?: number | null) {
  const wKg = p.weight_lbs != null
    ? (p.weight_unit === 'kg' ? p.weight_lbs : p.weight_lbs / 2.20462)
    : 0
  const base = wKg * 35
  // Exercise water from the manual training-hours baseline (~500 ml per daily hour).
  const exercise = (p.activity_hrs_per_week || 0) / 7 * 500
  const caffeineMg = todayCaffeineMg ?? p.caffeine_mg_per_day ?? 0
  const caffeine = Math.max(0, caffeineMg - 200) * 1.5
  const subs = (p.substances || []).reduce((acc, x) => acc + subExtraMl(x), 0)
  let adjust = 0
  if (p.sex === 'm') adjust += 200
  if ((p.age || 0) >= 50) adjust += 100
  return { base, exercise, caffeine, subs, adjust, total: base + exercise + caffeine + subs + adjust }
}

function unitVolOz(p: WaterProfile): number {
  if (p.water_unit === 'glass') return (p.glass_ml || 250) / ML_PER_OZ
  return (p.bottle_ml || 500) / ML_PER_OZ
}

function unitLabelSingular(p: WaterProfile): string {
  return p.water_unit === 'glass' ? 'glass' : 'bottle'
}

function unitLabelPlural(p: WaterProfile): string {
  return p.water_unit === 'glass' ? 'glasses' : 'bottles'
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

function WToggleRow({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-white">{label}</div>
        {hint && <div className="text-[11px] text-white/40 mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className="relative shrink-0 inline-flex h-[26px] w-[46px] items-center rounded-full transition-colors"
        style={{ background: checked ? 'rgba(74,222,128,0.55)' : 'rgba(255,255,255,0.12)' }}
      >
        <span
          className="inline-block h-[20px] w-[20px] rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(23px)' : 'translateX(3px)' }}
        />
      </button>
    </div>
  )
}

const INPUT_CLS = 'bg-black/[0.28] border border-white/[0.06] text-white text-[14px] px-3 py-2.5 rounded-[10px] outline-none focus:border-[rgba(110,231,183,0.40)] w-full'

// Numeric field that tolerates being emptied: the draft string is the source of
// truth while typing, so clearing the field (or a partial "16.") never snaps
// back to the last saved value — same fix as the gym rep-range inputs. Empty
// reports null and the caller decides what that means. Only safe inside the
// settings modal, which unmounts on close and re-seeds the draft on open.
function WNumInput({ value, onChange, className, ...rest }: {
  value: number | null
  onChange: (n: number | null) => void
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'className'>) {
  const [draft, setDraft] = useState(() => (value == null || value === 0 ? '' : String(value)))
  return (
    <input
      type="number"
      placeholder="0"
      value={draft}
      onFocus={e => e.target.select()}
      onChange={e => {
        const raw = e.target.value
        setDraft(raw)
        const n = parseFloat(raw)
        onChange(raw === '' || !Number.isFinite(n) ? null : n)
      }}
      className={className ?? INPUT_CLS}
      {...rest}
    />
  )
}

function WaterSection({
  initialWater,
  initialCaffeine,
  initialProfile,
  settingsOpen,
  setSettingsOpen,
}: {
  initialWater: WaterLog[]
  initialCaffeine: CaffeineLog[]
  initialProfile: HealthProfile | null
  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
}) {
  const [whyOpen, setWhyOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [subSearch, setSubSearch] = useState('')
  const [showSubResults, setShowSubResults] = useState(false)
  const [localProfile, setLocalProfile] = useState<WaterProfile>(() => mergeProfile(initialProfile))
  const [savingSettings, setSavingSettings] = useState(false)
  const [caffeineMode, setCaffeineMode] = useState<'auto' | 'manual'>('auto')
  // The settings modal must portal to document.body (transformed ancestors on
  // this page trap `fixed` overlays — see the food section's portal note) and
  // freeze the page behind it, otherwise touch scrolling inside the sheet
  // drives the health page underneath.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  useLockBodyScroll(settingsOpen)

  // Use rolledDate() (3am rollover) so water resets on the same schedule as supplements
  const [waterDate] = useState(() => rolledDate())

  const { data: waterLogs } = useWaterLogs(waterDate, initialWater)
  const { data: profileData } = useHealthProfile(initialProfile)
  const { data: history } = useWaterHistory()
  const { data: caffeineLogs } = useCaffeineLogs(waterDate, initialCaffeine)
  const logWater = useLogWater(waterDate)
  const deleteWater = useDeleteWaterLog(waterDate)
  const updateProfile = useUpdateHealthProfile()
  const todayCaffeineMg = caffeineLogs?.reduce((sum, l) => sum + l.amount_mg, 0) ?? 0

  useEffect(() => {
    if (!settingsOpen) setLocalProfile(mergeProfile(profileData))
  }, [settingsOpen, profileData])

  const totalOz = waterLogs?.reduce((sum, l) => sum + l.amount_oz, 0) ?? 0
  const unitVol = unitVolOz(localProfile)
  const calc = computeTarget(
    localProfile,
    caffeineMode === 'auto' ? todayCaffeineMg : null,
  )
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
    <section id="water" className="scroll-mt-6">
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
                  {calc.caffeine > 0 && <WhyRow label={caffeineMode === 'auto' ? `+ Caffeine (${todayCaffeineMg}mg today, auto)` : `+ Caffeine (${localProfile.caffeine_mg_per_day}mg/day, manual)`} val={`+ ${fmtMl(calc.caffeine)}`} />}
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
      <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] mb-3.5 overflow-hidden">
        <button
          type="button"
          onClick={() => setHistoryOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-[18px] bg-transparent border-0 cursor-pointer"
        >
          <span className="text-[10px] font-bold tracking-[0.20em] uppercase text-white/40">LAST 14 DAYS</span>
          <span className={`text-[14px] text-white/30 transition-transform duration-200 inline-block ${historyOpen ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {historyOpen && (
          <div className="px-5 pb-[18px]">
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
        )}
      </div>

      {/* Settings Modal */}
      {settingsOpen && mounted && createPortal(
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-5 bg-black/65"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={() => setSettingsOpen(false)}
        >
          <div
            className="w-full max-w-[480px] bg-[#111113] border border-white/[0.14] rounded-2xl p-[22px] max-h-[88vh] overflow-y-auto overscroll-contain"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="m-0 mb-3.5 text-[17px] font-bold">Settings</h3>

            <WSettingSection title="Profile">
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Weight">
                  <WNumInput inputMode="decimal" step="0.5" min="20" max="300"
                    value={localProfile.weight_lbs}
                    onChange={n => updateLocal({ weight_lbs: n })} />
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
                  <WNumInput inputMode="numeric" min="13" max="100"
                    value={localProfile.age}
                    onChange={n => updateLocal({ age: n == null ? null : Math.round(n) })} />
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
                  <WNumInput inputMode="numeric" min="3" max="8"
                    value={localProfile.height_cm != null ? Math.floor(Math.round(localProfile.height_cm / 2.54) / 12) : null}
                    onChange={n => {
                      const ft = n ?? 0
                      const existingIn = localProfile.height_cm != null
                        ? Math.round(localProfile.height_cm / 2.54) % 12
                        : 0
                      updateLocal({ height_cm: (ft * 12 + existingIn) * 2.54 })
                    }} />
                </WSettingField>
                <WSettingField label="Height (in)">
                  <WNumInput inputMode="numeric" min="0" max="11"
                    value={localProfile.height_cm != null ? Math.round(localProfile.height_cm / 2.54) % 12 : null}
                    onChange={n => {
                      const inches = n ?? 0
                      const existingFt = localProfile.height_cm != null
                        ? Math.floor(Math.round(localProfile.height_cm / 2.54) / 12)
                        : 0
                      updateLocal({ height_cm: (existingFt * 12 + inches) * 2.54 })
                    }} />
                </WSettingField>
              </div>
              <WSettingField label="Activity (training hours per week)">
                <WNumInput inputMode="decimal" min="0" max="40" step="0.5"
                  value={localProfile.activity_hrs_per_week}
                  onChange={n => updateLocal({ activity_hrs_per_week: n ?? 0 })} />
              </WSettingField>
            </WSettingSection>

            <WSettingSection title="Display">
              <WSettingField label="Show water as">
                <WSegControl
                  value={localProfile.water_unit}
                  options={[
                    { label: 'Bottles', value: 'bottle' },
                    { label: 'Glasses', value: 'glass' },
                  ]}
                  onChange={v => updateLocal({ water_unit: v as 'bottle' | 'glass' })}
                />
              </WSettingField>
              <div className="grid grid-cols-2 gap-2.5">
                <WSettingField label="Bottle size (oz)">
                  <WNumInput inputMode="decimal" min="4" max="64" step="1"
                    value={localProfile.bottle_ml ? Math.round((localProfile.bottle_ml / ML_PER_OZ) * 10) / 10 : null}
                    onChange={n => updateLocal({ bottle_ml: n != null ? n * ML_PER_OZ : 0 })} />
                </WSettingField>
                <WSettingField label="Glass size (oz)">
                  <WNumInput inputMode="decimal" min="4" max="32" step="1"
                    value={localProfile.glass_ml ? Math.round((localProfile.glass_ml / ML_PER_OZ) * 10) / 10 : null}
                    onChange={n => updateLocal({ glass_ml: n != null ? n * ML_PER_OZ : 0 })} />
                </WSettingField>
              </div>
            </WSettingSection>

            <WSettingSection title="Caffeine">
              <WSettingField label="Source">
                <WSegControl
                  value={caffeineMode}
                  options={[{ label: 'Auto (today\'s logs)', value: 'auto' }, { label: 'Manual', value: 'manual' }]}
                  onChange={v => setCaffeineMode(v as 'auto' | 'manual')}
                />
              </WSettingField>
              {caffeineMode === 'auto' ? (
                <WSettingField
                  label="Today's caffeine (mg)"
                  hint="Auto-summed from your caffeine logs. Above 200mg/day adds a small water requirement."
                >
                  <input
                    type="number"
                    value={Math.round(todayCaffeineMg)}
                    readOnly
                    className={`${INPUT_CLS} opacity-50 cursor-not-allowed`}
                  />
                </WSettingField>
              ) : (
                <WSettingField
                  label="Average caffeine per day (mg)"
                  hint="~1 cup of coffee = 95mg · espresso shot = 75mg · energy drink = 160mg. Above 200mg/day starts to add a small water requirement."
                >
                  <WNumInput inputMode="numeric" min="0" max="1000" step="10"
                    value={localProfile.caffeine_mg_per_day}
                    onChange={n => updateLocal({ caffeine_mg_per_day: n ?? 0 })} />
                </WSettingField>
              )}
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
                          <WNumInput
                            inputMode="decimal" min="0" step="0.5"
                            value={s.dose ?? s.defaultDose}
                            onChange={n => {
                              const dose = n ?? 0
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

            <WSettingSection title="Wearables">
              <WToggleRow
                label="Wearable card"
                hint="Show the Oura Ring / WHOOP / Fitbit card on the Health page."
                checked={localProfile.show_oura}
                onChange={v => updateLocal({ show_oura: v })}
              />
              <WToggleRow
                label="Apple Watch card"
                hint="Show the Apple Watch card (only appears when Apple Health has synced recently)."
                checked={localProfile.show_apple_watch}
                onChange={v => updateLocal({ show_apple_watch: v })}
              />
              <WearableSwitchRows />
            </WSettingSection>

            <WSettingSection title="Apple Health">
              <AppleHealthCard />
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
        </div>,
        document.body,
      )}
    </section>
  )
}

// ─── Caffeine Card (compact nav tile → /health/caffeine) ──────────────────────

function CaffeineSection({
  initialCaffeine,
  today,
  ouraData,
  workouts,
  meals,
  typicalWakeHour,
}: {
  initialCaffeine: CaffeineLog[]
  today: string
  ouraData: OuraData | null
  workouts: WorkoutPoint[]
  meals: MealPoint[]
  typicalWakeHour: number | null
}) {
  const { data: caffeineLogs } = useCaffeineLogs(today, initialCaffeine)

  const totalMg = caffeineLogs?.reduce((sum, l) => sum + l.amount_mg, 0) ?? 0

  // Live energy score — same model + inputs as Today's Curve, so the two match.
  const computeNow = useCallback(() => {
    const now = new Date()
    const h = toEnergyDayHour(now.getHours() + now.getMinutes() / 60)
    return currentEnergyFromLogs(h, caffeineLogs ?? initialCaffeine, ouraData, workouts, meals, typicalWakeHour)
  }, [caffeineLogs, initialCaffeine, ouraData, workouts, meals, typicalWakeHour])

  const [energy, setEnergy] = useState(computeNow)
  useEffect(() => {
    setEnergy(computeNow())
    const id = setInterval(() => setEnergy(computeNow()), 60_000)
    return () => clearInterval(id)
  }, [computeNow])

  const color = energyColorShared(energy)
  const circumference = 2 * Math.PI * 28
  const ringOffset = circumference * (1 - energy / 100)

  const energyStateLabel = energyLabelShared(energy)

  return (
    <section id="caffeine" className="scroll-mt-6">
      <div className="flex items-center gap-4 mb-3.5">
        <div className="flex-1 h-px bg-white/[0.10]" />
        <span className="text-[11px] font-semibold tracking-[0.22em] text-white/85">CAFFEINE</span>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>
      <Link
        href="/health/caffeine"
        className="cosmic-card block p-4 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center gap-4">
          {/* Orb ring */}
          <div className="relative w-[62px] h-[62px] flex-shrink-0">
            {/* Glow */}
            <div
              className="absolute inset-0 rounded-full opacity-30 blur-md"
              style={{ background: color, animation: 'cosmicPulseGlow 3s ease-in-out infinite' }}
            />
            <svg viewBox="0 0 70 70" className="relative w-full h-full">
              <circle cx="35" cy="35" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4"/>
              <circle
                cx="35" cy="35" r="28"
                fill="none"
                stroke={color}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={circumference.toFixed(1)}
                strokeDashoffset={ringOffset.toFixed(1)}
                transform="rotate(-90 35 35)"
                style={{ transition: 'stroke-dashoffset 600ms cubic-bezier(.16,1,.3,1), stroke 400ms' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-serif italic text-lg leading-none" style={{ color }}>
                {Math.round(energy)}
              </span>
            </div>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="text-[9px] font-mono text-zinc-600 tracking-[0.15em] uppercase mb-0.5">Energy</p>
            <p className="text-base font-semibold text-white">{energyStateLabel}</p>
            <p className="text-[10px] text-zinc-500 mt-0.5">
              {totalMg > 0 ? `${Math.round(totalMg)}mg today` : 'No doses yet'}
            </p>
          </div>

          {/* Arrow */}
          <div className="text-zinc-600 text-lg">→</div>
        </div>
      </Link>
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
  const [fat, setFat] = useState(String(meal.fat_g ?? ''))
  const [notes, setNotes] = useState(meal.notes ?? '')
  const [emoji, setEmoji] = useState<string | null>(meal.emoji ?? null)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4 max-h-[88vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {meal.photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meal.photo_url} alt={meal.item_name} className="w-full h-40 object-cover rounded-xl" />
        )}
        <div className="flex items-start gap-2">
          <FoodEmojiPicker name={name} source={meal.source} value={emoji} onChange={setEmoji} />
          <input
            className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
            placeholder="Meal name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Cal</label>
            <input type="number" inputMode="numeric" min="0" placeholder="0" onFocus={e => e.target.select()} className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={calories} onChange={e => setCalories(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">P (g)</label>
            <input type="number" inputMode="decimal" min="0" placeholder="0" onFocus={e => e.target.select()} className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={protein} onChange={e => setProtein(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">C (g)</label>
            <input type="number" inputMode="decimal" min="0" placeholder="0" onFocus={e => e.target.select()} className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={carbs} onChange={e => setCarbs(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">F (g)</label>
            <input type="number" inputMode="decimal" min="0" placeholder="0" onFocus={e => e.target.select()} className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={fat} onChange={e => setFat(e.target.value)} />
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
                fat_g: fat ? parseFloat(fat) : meal.fat_g,
                notes: notes.trim() || null,
                emoji,
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

type FitnessGoal = 'cut' | 'recomp' | 'lean_bulk' | 'maintain'
type CutPace = 'slow' | 'moderate' | 'aggressive'

const GOAL_META: Record<FitnessGoal, { label: string; sub: string }> = {
  cut:       { label: 'Cut',       sub: 'Lose fat, preserve muscle' },
  recomp:    { label: 'Recomp',    sub: 'Lose fat + gain muscle simultaneously' },
  lean_bulk: { label: 'Lean Bulk', sub: 'Build muscle, minimize fat gain' },
  maintain:  { label: 'Maintain',  sub: 'Stay where you are, stay fueled' },
}

// Same hrs/week buckets the calorie-target route uses for its TDEE multiplier,
// so the label here always matches what Calculate will actually assume.
function activityLabel(hrs: number): string {
  if (hrs < 2) return 'Sedentary'
  if (hrs < 5) return 'Lightly Active'
  if (hrs < 10) return 'Moderately Active'
  return 'Very Active'
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  getLabel,
}: {
  options: T[]
  value: T
  onChange: (v: T) => void
  getLabel: (v: T) => string
}) {
  return (
    <div className="flex gap-1 rounded-[10px] bg-white/[0.04] border border-white/[0.06] p-[3px]">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 rounded-[7px] py-2.5 text-xs font-semibold transition-colors ${value === opt ? 'text-[#0a0a0b]' : 'text-white/40'}`}
          style={value === opt ? { background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' } : {}}
        >
          {getLabel(opt)}
        </button>
      ))}
    </div>
  )
}

function CalorieTargetSheet({
  profile,
  onSave,
  onClose,
}: {
  profile: {
    fitness_goal?: string | null
    target_weight_lbs?: number | null
    cut_pace?: string | null
    activity_hrs_per_week?: number | null
    target_reasoning?: string | null
    daily_calorie_target?: number | null
    daily_protein_target_g?: number | null
    daily_carbs_target_g?: number | null
  }
  onSave: () => void
  onClose: () => void
}) {
  const [goal, setGoal] = useState<FitnessGoal>((profile.fitness_goal as FitnessGoal) ?? 'cut')
  const [targetWeight, setTargetWeight] = useState(String(profile.target_weight_lbs ?? ''))
  const [cutPace, setCutPace] = useState<CutPace>((profile.cut_pace as CutPace) ?? 'moderate')
  const [bulkPace, setBulkPace] = useState<'slow' | 'moderate'>('slow')
  const [result, setResult] = useState<{ daily_calories: number; protein_g: number; carbs_g: number; reasoning: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [editingMacros, setEditingMacros] = useState(false)
  const [editedMacros, setEditedMacros] = useState<{ cal: string; protein: string; carbs: string } | null>(null)
  const [calcError, setCalcError] = useState<string | null>(null)
  const [calcNoKeyProvider, setCalcNoKeyProvider] = useState<KeyProvider | null>(null)
  const [calcAiLimit, setCalcAiLimit] = useState(false)

  const updateProfile = useUpdateHealthProfile()
  const calcTarget = useCalculateCalorieTarget()

  const needsTargetWeight = goal === 'cut' || goal === 'lean_bulk'

  const canCalculate = needsTargetWeight ? !!parseFloat(targetWeight) : true

  async function handleCalculate() {
    setCalcError(null)
    setCalcNoKeyProvider(null)
    setCalcAiLimit(false)
    const updates: Record<string, unknown> = {
      fitness_goal: goal,
    }
    if (goal === 'cut') {
      updates.target_weight_lbs = parseFloat(targetWeight)
      updates.cut_pace = cutPace
    } else if (goal === 'lean_bulk') {
      updates.target_weight_lbs = parseFloat(targetWeight)
      updates.cut_pace = bulkPace   // slow=+200, moderate=+300
    } else {
      updates.cut_pace = null
      if (goal !== 'recomp') updates.target_weight_lbs = null
    }
    try {
      await updateProfile.mutateAsync(updates as Parameters<typeof updateProfile.mutateAsync>[0])
      const res = await calcTarget.mutateAsync()
      setResult(res)
      setEditingMacros(false)
      setEditedMacros(null)
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setCalcNoKeyProvider(err.provider)
      else if (err instanceof AiLimitClientError) setCalcAiLimit(true)
      else setCalcError(err instanceof Error ? err.message : 'Failed to calculate target')
    }
  }

  function startEditMacros() {
    if (!result) return
    setEditedMacros(prev => prev ?? {
      cal: String(result.daily_calories),
      protein: String(result.protein_g),
      carbs: String(result.carbs_g),
    })
    setEditingMacros(true)
  }

  const macrosValid = !editedMacros || (['cal', 'protein', 'carbs'] as const).every(k => {
    const n = Number(editedMacros[k])
    return editedMacros[k].trim() !== '' && Number.isFinite(n) && n >= 0
  })

  async function handleSaveTarget() {
    if (editedMacros && macrosValid) {
      await updateProfile.mutateAsync({
        daily_calorie_target: Math.round(Number(editedMacros.cal)),
        daily_protein_target_g: Math.round(Number(editedMacros.protein)),
        daily_carbs_target_g: Math.round(Number(editedMacros.carbs)),
      } as Parameters<typeof updateProfile.mutateAsync>[0])
    }
    setSaved(true)
    onSave()
  }

  const cutPaceHint: Record<CutPace, string> = {
    slow: '0.5 lb/week — gentle deficit',
    moderate: '1 lb/week — standard cut',
    aggressive: '1.5 lb/week — aggressive cut',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-4"
      style={{ backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-white">Set fitness goal</h3>

        {/* Goal type */}
        <div>
          <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Goal</label>
          <div className="grid grid-cols-2 gap-2">
            {(['cut', 'recomp', 'lean_bulk', 'maintain'] as FitnessGoal[]).map(g => (
              <button
                key={g}
                onClick={() => { setGoal(g); setResult(null) }}
                className={`rounded-[10px] border px-3 py-3 text-left transition-colors ${goal === g ? 'border-white/40 bg-white/[0.07]' : 'border-white/[0.08] bg-white/[0.02]'}`}
              >
                <p className={`text-sm font-semibold ${goal === g ? 'text-white' : 'text-zinc-400'}`}>{GOAL_META[g].label}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5 leading-snug">{GOAL_META[g].sub}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Activity level — read-only, pulled from profile settings */}
        <div className="flex items-center justify-between rounded-[10px] border border-white/[0.08] bg-white/[0.02] px-3 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Activity level</span>
          <span className="text-xs text-zinc-400">
            {profile.activity_hrs_per_week != null
              ? `${activityLabel(profile.activity_hrs_per_week)} · ${profile.activity_hrs_per_week} hrs/wk`
              : 'Not set'}{' '}
            <span className="text-zinc-600">(from settings)</span>
          </span>
        </div>

        {/* Goal-specific fields */}
        {goal === 'cut' && (
          <>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Target weight (lbs)</label>
              <input
                type="number" inputMode="decimal" min="80" max="500" step="0.5"
                className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
                placeholder="e.g. 165"
                value={targetWeight}
                onChange={e => { setTargetWeight(e.target.value); setResult(null) }}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Pace</label>
              <SegmentedControl
                options={['slow', 'moderate', 'aggressive'] as CutPace[]}
                value={cutPace}
                onChange={v => { setCutPace(v); setResult(null) }}
                getLabel={v => v.charAt(0).toUpperCase() + v.slice(1)}
              />
              <p className="mt-1.5 text-[10px] text-zinc-600">{cutPaceHint[cutPace]}</p>
            </div>
          </>
        )}

        {goal === 'recomp' && (
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-3 space-y-1">
            <p className="text-xs font-semibold text-white">Maintenance calories, high protein</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              The scale won&apos;t move much. Body fat drops while muscle increases — but only with consistent strength training. Protein target will be high: ~1g/lb bodyweight.
            </p>
          </div>
        )}

        {goal === 'lean_bulk' && (
          <>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Goal weight (lbs)</label>
              <input
                type="number" inputMode="decimal" min="80" max="500" step="0.5"
                className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
                placeholder="e.g. 185"
                value={targetWeight}
                onChange={e => { setTargetWeight(e.target.value); setResult(null) }}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Surplus</label>
              <SegmentedControl
                options={['slow', 'moderate'] as ('slow' | 'moderate')[]}
                value={bulkPace}
                onChange={v => { setBulkPace(v); setResult(null) }}
                getLabel={v => v === 'slow' ? 'Conservative' : 'Moderate'}
              />
              <p className="mt-1.5 text-[10px] text-zinc-600">
                {bulkPace === 'slow' ? '+200 cal/day — minimal fat gain, slow growth' : '+300 cal/day — faster growth, some fat gain acceptable'}
              </p>
            </div>
          </>
        )}

        {goal === 'maintain' && (
          <div className="rounded-[10px] border border-white/[0.06] bg-white/[0.02] px-3 py-3 space-y-1">
            <p className="text-xs font-semibold text-white">Maintenance calories</p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Targets set to your TDEE at current activity level. Protein target keeps muscle. No deficit, no surplus.
            </p>
          </div>
        )}

        {result && (
          <div className="cosmic-card p-4 space-y-3">
            {!editingMacros ? (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-bold text-white">
                  {(editedMacros ? Math.round(Number(editedMacros.cal)) : result.daily_calories).toLocaleString()} cal · {editedMacros ? Math.round(Number(editedMacros.protein)) : result.protein_g}g P · {editedMacros ? Math.round(Number(editedMacros.carbs)) : result.carbs_g}g C
                </p>
                <button
                  onClick={startEditMacros}
                  className="shrink-0 text-[11px] font-semibold text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
                >
                  Edit macros
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Edit macros</p>
                  <button
                    onClick={() => setEditingMacros(false)}
                    disabled={!macrosValid}
                    className="text-[11px] font-semibold text-zinc-400 hover:text-white disabled:opacity-40"
                  >
                    Done
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: 'cal', label: 'Calories' },
                    { key: 'protein', label: 'Protein (g)' },
                    { key: 'carbs', label: 'Carbs (g)' },
                  ] as const).map(({ key, label }) => (
                    <div key={key}>
                      <label className="mb-1 block text-[9px] font-semibold uppercase tracking-wide text-zinc-600">{label}</label>
                      <input
                        type="number" inputMode="numeric" min="0"
                        className="w-full rounded-[8px] border border-white/[0.12] bg-black/25 px-2 py-2 text-sm text-white tabular-nums outline-none focus:border-white/40"
                        value={editedMacros?.[key] ?? ''}
                        onChange={e => setEditedMacros(prev => ({ ...(prev ?? { cal: '', protein: '', carbs: '' }), [key]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <ChatText className="text-xs text-zinc-400 leading-relaxed" text={result.reasoning} />
            {editedMacros && !editingMacros && (
              <p className="text-[10px] text-zinc-600">
                Manually adjusted from {result.daily_calories.toLocaleString()} cal · {result.protein_g}g P · {result.carbs_g}g C
              </p>
            )}
          </div>
        )}

        {calcNoKeyProvider ? (
          <NoApiKeyNotice provider={calcNoKeyProvider} />
        ) : calcAiLimit ? (
          <AiLimitNotice />
        ) : calcError ? (
          <p className="text-xs text-red-400">{calcError}</p>
        ) : null}

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/[0.12] py-3 text-sm font-semibold text-zinc-400">
            Cancel
          </button>
          {!result ? (
            <button
              onClick={handleCalculate}
              disabled={!canCalculate || calcTarget.isPending || updateProfile.isPending}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-[#0a0a0b] disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
            >
              {calcTarget.isPending ? 'Calculating…' : 'Calculate'}
            </button>
          ) : (
            <button
              onClick={handleSaveTarget}
              disabled={saved || !macrosValid || updateProfile.isPending}
              className="flex-1 rounded-xl py-3 text-sm font-bold text-[#0a0a0b] disabled:opacity-40"
              style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
            >
              {updateProfile.isPending ? 'Saving…' : 'Save target'}
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
  const libraryInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [editingMeal, setEditingMeal] = useState<FoodLog | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [newlyLoggedId, setNewlyLoggedId] = useState<string | null>(null)
  const [mealFeedback, setMealFeedback] = useState<Record<string, string>>({})
  const [targetSheetOpen, setTargetSheetOpen] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [wizardKind, setWizardKind] = useState<'food' | 'drink' | null>(null)
  const [wizardDescription, setWizardDescription] = useState<string | undefined>(undefined)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [waterNote, setWaterNote] = useState<number | null>(null)
  const [caffeineNote, setCaffeineNote] = useState<number | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoNoKeyProvider, setPhotoNoKeyProvider] = useState<KeyProvider | null>(null)
  const [photoAiLimit, setPhotoAiLimit] = useState(false)
  const labelHintRef = useRef(false)
  const updateProfile = useUpdateHealthProfile()
  // Overlays must portal to document.body — the health page has ancestors with
  // transform/backdrop-filter/isolation that trap `fixed` children in a local
  // stacking context, so an inline modal renders off-screen and lets the page
  // behind stay interactive. mounted guard avoids touching document during SSR.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const today = rolledDate()

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
    setPendingFiles(prev => {
      if (prev.length >= 3) return prev
      return [...prev, file]
    })
    setPendingPreviews(prev => {
      if (prev.length >= 3) return prev
      return [...prev, URL.createObjectURL(file)]
    })
    if (pendingFiles.length === 0) {
      // Barcode fallback "snap the label" pre-fills a hint for the vision model
      setDescription(labelHintRef.current ? 'This photo shows a nutrition facts label — read the values on it exactly.' : '')
    }
    labelHintRef.current = false
  }, [pendingFiles.length])

  const streamNonPhotoFeedback = useCallback(async (mealId: string) => {
    try {
      const res = await fetch(`/api/health/food/${mealId}/coach`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const noKey = await checkNoApiKey(res)
        if (noKey) setMealFeedback(prev => ({ ...prev, [mealId]: noApiKeyMessage(noKey.provider) }))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setMealFeedback(prev => ({ ...prev, [mealId]: (prev[mealId] ?? '') + decoder.decode(value) }))
      }
    } catch (err) {
      console.error('[FoodSection] non-photo coach error:', err)
    }
  }, [])

  const handleManualSaved = useCallback((res: { water_logged: boolean; volume_oz: number | null; caffeine_logged?: boolean; caffeine_mg?: number; id?: string }) => {
    if (res.water_logged && res.volume_oz) {
      setWaterNote(res.volume_oz)
      setTimeout(() => setWaterNote(null), 4000)
    }
    if (res.caffeine_logged && res.caffeine_mg) {
      setCaffeineNote(res.caffeine_mg)
      setTimeout(() => setCaffeineNote(null), 4000)
    }
    if (res.id) {
      streamNonPhotoFeedback(res.id)
    }
  }, [streamNonPhotoFeedback])

  const removePendingPhoto = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index))
    setPendingPreviews(prev => {
      URL.revokeObjectURL(prev[index])
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const clearPending = useCallback(() => {
    setPendingPreviews(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return [] })
    setPendingFiles([])
    setDescription('')
  }, [])

  const submitPendingPhoto = useCallback(async () => {
    if (pendingFiles.length === 0) return
    setUploading(true)
    setPhotoError(null)
    setPhotoNoKeyProvider(null)
    setPhotoAiLimit(false)
    const filesToSubmit = pendingFiles
    clearPending()
    try {
      const fd = new FormData()
      for (const f of filesToSubmit) {
        const resized = await resizeImage(f, 1024)
        fd.append('photo', resized, 'meal.jpg')
      }
      fd.append('date', rolledDate())
      if (description.trim()) fd.append('description', description.trim())
      const newMeal = await logFood.mutateAsync(fd)
      setNewlyLoggedId(newMeal.id)
    } catch (err) {
      if (err instanceof NoApiKeyClientError) {
        setPhotoNoKeyProvider(err.provider)
      } else if (err instanceof AiLimitClientError) {
        setPhotoAiLimit(true)
      } else {
        console.error('Food log error:', err)
        setPhotoError('Failed to log meal. Try again.')
      }
    } finally {
      setUploading(false)
      setDescription('')
    }
  }, [pendingFiles, description, logFood, clearPending])

  return (
    <>
    <section id="food" className="scroll-mt-6">
      <div className="flex items-center gap-4 mb-3.5">
        <div className="flex-1 h-px bg-white/[0.10]" />
        <span className="text-[11px] font-semibold tracking-[0.22em] text-white/85">FOOD</span>
        <div className="flex-1 h-px bg-white/[0.10]" />
      </div>

      <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] p-4 space-y-3">
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
          <div className="space-y-2.5">
            <p className="text-sm text-zinc-300">
              {totals.calories.toLocaleString()} cal · {Math.round(totals.protein_g)}g P · {Math.round(totals.carbs_g)}g C · {(meals ?? []).length} meal{(meals ?? []).length !== 1 ? 's' : ''}
            </p>
            {/* Onboarding nudge — only shows until a target is set, then it's
                replaced by the macro bars + "Edit target" below. */}
            <button
              onClick={() => setTargetSheetOpen(true)}
              className="w-full flex items-center gap-3 rounded-xl border border-emerald-300/30 bg-emerald-300/[0.06] px-3.5 py-3 text-left active:opacity-70 transition-colors"
            >
              <span className="text-lg leading-none">🎯</span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-emerald-200">Set a calorie target</span>
                <span className="block text-xs text-zinc-400">Track your daily calories and macros against a goal.</span>
              </span>
              <span className="shrink-0 text-lg text-emerald-300">→</span>
            </button>
          </div>
        )}

        {/* Entry buttons */}
        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhoto}
          />
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhoto}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] py-3 text-white disabled:opacity-50 hover:bg-white/[0.04] active:opacity-70 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span className="text-xs font-semibold text-zinc-300">{uploading ? 'Estimating…' : 'Camera'}</span>
            </button>
            <button
              onClick={() => libraryInputRef.current?.click()}
              disabled={uploading}
              className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/[0.12] py-3 text-white disabled:opacity-50 hover:bg-white/[0.04] active:opacity-70 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <span className="text-xs font-semibold text-zinc-300">{uploading ? 'Estimating…' : 'Library'}</span>
            </button>
          </div>
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <button
              onClick={() => setBuilderOpen(true)}
              className="rounded-xl py-2 text-xs font-bold text-black active:opacity-80"
              style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
            >
              ＋ Add food
            </button>
            <button
              onClick={() => setScanOpen(true)}
              className="rounded-xl bg-white/[0.04] border border-white/[0.08] py-2 text-xs font-semibold text-zinc-300 hover:bg-white/[0.07] transition-colors"
            >
              ▮▮ Scan
            </button>
          </div>
        </div>

        {waterNote != null && (
          <p className="text-xs text-sky-300">+{waterNote} oz added to water tracker</p>
        )}

        {caffeineNote != null && (
          <p className="text-xs text-amber-300">+{caffeineNote} mg added to caffeine tracker</p>
        )}

        {photoNoKeyProvider ? (
          <NoApiKeyNotice provider={photoNoKeyProvider} />
        ) : photoAiLimit ? (
          <AiLimitNotice />
        ) : photoError ? (
          <p className="text-xs text-red-400">{photoError}</p>
        ) : null}

        {/* Frequents */}
        <FrequentsRow onSaved={handleManualSaved} />

        {/* Meal list */}
        {!isLoading && (meals ?? []).length > 0 && (
          <div className="space-y-2 pt-1">
            {(meals ?? []).map(meal => (
              <div key={meal.id}>
                {meal.source === 'photo' ? (
                  <PhotoMealCard
                    meal={meal}
                    today={today}
                    onEdit={() => setEditingMeal(meal)}
                    isNew={newlyLoggedId === meal.id}
                  />
                ) : confirmDeleteId === meal.id ? (
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
                  <div className="rounded-[10px] bg-white/[0.035] overflow-hidden">
                    <div
                      className="flex w-full items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-white/[0.05] transition-colors"
                      onClick={() => setEditingMeal(meal)}
                    >
                      <div className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.05] flex items-center justify-center text-lg leading-none">
                        {foodEmoji(meal.item_name, { source: meal.source, override: meal.emoji })}
                      </div>
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
                    {(mealFeedback[meal.id] || meal.coach_feedback) && (
                      <ChatText
                        className="px-3 pb-2.5 text-xs italic text-zinc-400 leading-relaxed border-t border-white/[0.05] pt-2"
                        text={mealFeedback[meal.id] || meal.coach_feedback || ''}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Food coach: Today's Fuel + Ask your coach */}
        <FoodCoachSection
          today={today}
          meals={meals ?? []}
          profile={profile}
        />

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
    </section>

    {mounted && createPortal(
      <>
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

      <AnimatePresence>
        {builderOpen && (
          <MealBuilderSheet
            onClose={() => setBuilderOpen(false)}
            onSaved={handleManualSaved}
            onDescribeWithAI={desc => {
              setBuilderOpen(false)
              setWizardDescription(desc)
              setWizardKind('food')
            }}
          />
        )}
      </AnimatePresence>

      {wizardKind && (
        <FoodWizardSheet
          kind={wizardKind}
          initialDescription={wizardDescription}
          onClose={() => {
            setWizardKind(null)
            setWizardDescription(undefined)
          }}
          onSaved={handleManualSaved}
        />
      )}

      {scanOpen && (
        <BarcodeFlow
          onClose={() => setScanOpen(false)}
          onTypeInstead={() => { setScanOpen(false); setWizardKind('food') }}
          onSnapLabel={() => {
            setScanOpen(false)
            labelHintRef.current = true
            fileInputRef.current?.click()
          }}
          onSaved={handleManualSaved}
        />
      )}

      {pendingPreviews.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4"
          style={{ backdropFilter: 'blur(6px)' }}
          onClick={clearPending}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            {/* Photo thumbnails */}
            <div className={`grid gap-2 ${pendingPreviews.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {pendingPreviews.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Photo ${i + 1}`}
                    className={`w-full object-cover rounded-xl ${pendingPreviews.length === 1 ? 'h-48' : 'h-24'}`}
                  />
                  <button
                    onClick={() => removePendingPhoto(i)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-white/70 text-xs leading-none"
                  >
                    ×
                  </button>
                </div>
              ))}
              {pendingPreviews.length < 3 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-24 rounded-xl border border-white/[0.12] bg-white/[0.03] flex flex-col items-center justify-center gap-1 text-white/30 active:opacity-60"
                >
                  <span className="text-2xl leading-none">+</span>
                  <span className="text-[10px]">{pendingPreviews.length}/3</span>
                </button>
              )}
            </div>
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
                onClick={clearPending}
                className="h-12 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-semibold text-zinc-400 active:opacity-80"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </>,
      document.body
    )}
    </>
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
        const noKey = await checkNoApiKey(res)
        setText(noKey ? noApiKeyMessage(noKey.provider) : 'Something went wrong. Try again.')
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
        className="flex h-12 w-full items-center justify-center rounded-xl bg-[#111113] border border-white/[0.06] text-sm font-medium text-zinc-300 disabled:opacity-60 active:opacity-80"
      >
        {streaming ? 'Thinking…' : 'Get coach feedback'}
      </button>
      {text && (
        <ChatText className="mt-3 text-sm leading-relaxed text-zinc-300" text={text} />
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
  wearableProvider,
  today,
  workouts,
  meals,
  typicalWakeHour,
  savedMeals,
  userIngredients,
}: Props) {
  const { data: profileData } = useHealthProfile(profile)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // /health#water, #supplements, #food, … land directly on that section
  useHashScroll()

  // Seed the meal-builder queries from the server render. Those hooks live
  // inside MealBuilderSheet, which only mounts on "Add food" — without this the
  // sheet animates up and *then* fetches, so saved meals arrive late. Seeding
  // here (rather than threading initialData through three components) marks
  // them fresh, so the sheet opens fully populated and the 60s staleTime plus
  // the existing mutation invalidations still keep them current.
  const qc = useQueryClient()
  useEffect(() => {
    qc.setQueryData(['saved-meals'], savedMeals)
    qc.setQueryData(['user-ingredients'], userIngredients)
  }, [qc, savedMeals, userIngredients])

  return (
    <main className="nebula-health page-rise min-h-screen space-y-5 px-4 pb-24 pt-14">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Health</h1>
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
      <HealthCoach />
      <WearablesSection
        wearableProvider={wearableProvider}
        initialOura={ouraData}
        today={today}
      />
      <FoodSection profile={profileData} />
      <StackTracker initialSupplements={supplements} initialLogs={todayLogs} today={today} />
      <WaterSection
        initialWater={todayWater}
        initialCaffeine={todayCaffeine}
        initialProfile={profile}
        settingsOpen={settingsOpen}
        setSettingsOpen={setSettingsOpen}
      />
      <CaffeineSection
        initialCaffeine={todayCaffeine}
        today={today}
        ouraData={ouraData}
        workouts={workouts}
        meals={meals}
        typicalWakeHour={typicalWakeHour}
      />
      <DebloatSection today={today} />
    </main>
  )
}
