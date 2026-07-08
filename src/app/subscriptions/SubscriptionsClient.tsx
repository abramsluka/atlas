'use client'

import { useState, useEffect, useRef } from 'react'
import { useSubscriptions } from '@/features/subscriptions/queries'
import {
  useCreateSubscription,
  useUpdateSubscription,
  useDeleteSubscription,
  useAnalyzeSubscriptionScreenshot,
} from '@/features/subscriptions/mutations'
import type {
  Subscription,
  SubscriptionWithMeta,
  CreateSubscriptionPayload,
  UpdateSubscriptionPayload,
  ImportedSubscription,
} from '@/features/subscriptions/types'
import { BILLING_PERIODS, CURRENCIES, CATEGORIES } from '@/features/subscriptions/types'

// ─── Utilities ───────────────────────────────────────────────────────────────

function monthlyEquivalent(amount: number, period: string): number {
  if (period === 'yearly') return amount / 12
  if (period === 'weekly') return (amount * 52) / 12
  return amount
}

function daysUntilRenewal(nextRenewal: string | null): number | null {
  if (!nextRenewal) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const renewal = new Date(nextRenewal + 'T00:00:00')
  return Math.round((renewal.getTime() - today.getTime()) / 86400000)
}

function formatRenewalLabel(nextRenewal: string | null): string {
  if (!nextRenewal) return ''
  const days = daysUntilRenewal(nextRenewal)
  const date = new Date(nextRenewal + 'T00:00:00')
  const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (days === null) return dateLabel
  if (days < 0) return `overdue · ${dateLabel}`
  if (days === 0) return `today · ${dateLabel}`
  if (days === 1) return `tomorrow · ${dateLabel}`
  if (days <= 7) return `in ${days}d · ${dateLabel}`
  return dateLabel
}

function todayISO(): string {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Adds one billing cycle to a YYYY-MM-DD string, clamping the day to the
// target month's length (so Jan 31 + 1mo → Feb 28/29, not Mar 3).
function addBillingPeriod(dateStr: string, period: 'weekly' | 'monthly' | 'yearly'): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (period === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d))
    dt.setUTCDate(dt.getUTCDate() + 7)
    return dt.toISOString().slice(0, 10)
  }
  const monthsToAdd = period === 'yearly' ? 12 : 1
  const flatIndex = (m - 1) + monthsToAdd
  const targetYear = y + Math.floor(flatIndex / 12)
  const targetMonth = (flatIndex % 12) + 1
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate()
  const day = Math.min(d, lastDay)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// The renewal date after paying the current cycle: always advance at least once,
// then keep advancing past any further missed cycles until it lands in the future.
function nextRenewalAfterPayment(dateStr: string, period: 'weekly' | 'monthly' | 'yearly'): string {
  const today = todayISO()
  let next = addBillingPeriod(dateStr, period)
  let guard = 0
  while (next <= today && guard < 1200) {
    next = addBillingPeriod(next, period)
    guard++
  }
  return next
}

function shortDateLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function enrichSubscription(sub: Subscription): SubscriptionWithMeta {
  const days = daysUntilRenewal(sub.next_renewal)
  return {
    ...sub,
    monthlyEquivalent: monthlyEquivalent(sub.amount, sub.billing_period),
    daysUntilRenewal: days,
    isUrgent: days !== null && days <= 5,
  }
}

function formatAmount(amount: number, currency: string): string {
  const symbols: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }
  const sym = symbols[currency]
  if (sym) return `${sym}${amount.toFixed(2)}`
  return `${currency} ${amount.toFixed(2)}`
}

function sortSubscriptions(subs: SubscriptionWithMeta[]): SubscriptionWithMeta[] {
  return [...subs].sort((a, b) => {
    if (a.isUrgent && !b.isUrgent) return -1
    if (!a.isUrgent && b.isUrgent) return 1
    if (a.daysUntilRenewal !== null && b.daysUntilRenewal !== null) {
      return a.daysUntilRenewal - b.daysUntilRenewal
    }
    if (a.daysUntilRenewal !== null) return -1
    if (b.daysUntilRenewal !== null) return 1
    return a.name.localeCompare(b.name)
  })
}

// Downscale + re-encode a picked image so the base64 payload stays small and the
// media type is always one Claude accepts, regardless of what the picker returns.
async function fileToBase64Image(file: File): Promise<{ imageBase64: string; mediaType: string }> {
  try {
    const bitmap = await createImageBitmap(file)
    const maxDim = 1568
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas context')
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    return { imageBase64: dataUrl.split(',')[1], mediaType: 'image/jpeg' }
  } catch {
    // Fallback: send the raw file as-is (covers browsers without createImageBitmap)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error('read failed'))
      reader.readAsDataURL(file)
    })
    return { imageBase64: dataUrl.split(',')[1], mediaType: file.type }
  }
}

// ─── Renewal Ticker ───────────────────────────────────────────────────────────

function RenewalTicker({ subs }: { subs: SubscriptionWithMeta[] }) {
  const withDates = subs.filter((s) => s.next_renewal !== null)
  const [activeIdx, setActiveIdx] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (withDates.length <= 1) return
    intervalRef.current = setInterval(() => {
      setActiveIdx((i) => (i + 1) % withDates.length)
    }, 3000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [withDates.length])

  if (withDates.length === 0) return null

  const active = withDates[activeIdx % withDates.length]
  const isActiveUrgent = active.isUrgent

  return (
    <div
      className={`mb-4 flex items-center gap-3 rounded-xl px-4 py-3 ${
        isActiveUrgent
          ? 'animate-pulse border border-red-400/40 bg-red-400/8'
          : 'border border-emerald-500/20 bg-emerald-500/5'
      }`}
    >
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${
          isActiveUrgent ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
        }`}
      >
        Renews
      </span>
      <div className="min-w-0 flex-1">
        <span className="truncate font-bold uppercase text-white text-sm tracking-wide">
          {active.name}
        </span>
        <span className={`mx-2 text-sm ${isActiveUrgent ? 'text-red-400' : 'text-emerald-400'}`}>
          {formatAmount(active.amount, active.currency)}
        </span>
        <span className="text-xs text-zinc-500">{formatRenewalLabel(active.next_renewal)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {withDates.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIdx(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === activeIdx % withDates.length
                ? isActiveUrgent
                  ? 'w-3 bg-red-400'
                  : 'w-3 bg-emerald-400'
                : 'w-1.5 bg-zinc-700'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function SummaryCard({ subs }: { subs: SubscriptionWithMeta[] }) {
  const currencies = [...new Set(subs.map((s) => s.currency))]
  const mixedCurrencies = currencies.length > 1
  const monthlyBurn = subs.reduce((acc, s) => acc + s.monthlyEquivalent, 0)
  const yearlyProjection = monthlyBurn * 12
  const primaryCurrency = currencies[0] ?? 'USD'

  return (
    <div className="mb-4 rounded-2xl border border-zinc-800/80 bg-zinc-900 px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Monthly burn
          </p>
          <p className="mt-0.5 text-2xl font-bold leading-tight text-white">
            {formatAmount(monthlyBurn, primaryCurrency)}
            <span className="ml-1 text-xs font-medium text-zinc-500">/mo</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold text-emerald-400">
            {formatAmount(yearlyProjection, primaryCurrency)}
            <span className="font-normal text-zinc-500">/yr</span>
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {subs.length} subscription{subs.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>
      {mixedCurrencies && (
        <p className="mt-1 text-[10px] text-zinc-600">
          Mixed currencies — amounts shown in originals
        </p>
      )}
    </div>
  )
}

// ─── Add / Edit Form ──────────────────────────────────────────────────────────

interface FormState {
  name: string
  amount: string
  currency: string
  billing_period: 'weekly' | 'monthly' | 'yearly'
  next_renewal: string
  auto_renews: boolean
  category: string
}

const defaultForm: FormState = {
  name: '',
  amount: '',
  currency: 'USD',
  billing_period: 'monthly',
  next_renewal: '',
  auto_renews: true,
  category: '',
}

function SubscriptionForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
  isPending,
}: {
  initial: FormState
  onSubmit: (f: FormState) => void
  onCancel: () => void
  submitLabel: string
  isPending: boolean
}) {
  const [form, setForm] = useState<FormState>(initial)

  function set(field: keyof FormState, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.amount) return
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Name
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Netflix, Spotify, etc."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
          required
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Amount
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={form.amount}
            onFocus={e => e.target.select()} onChange={(e) => set('amount', e.target.value)}
            placeholder="9.99"
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            required
          />
        </div>
        <div className="w-28">
          <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Currency
          </label>
          <select
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Billing period
        </label>
        <div className="flex gap-2">
          {BILLING_PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => set('billing_period', p.value)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium transition-colors ${
                form.billing_period === p.value
                  ? 'bg-white text-black'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Next renewal <span className="normal-case font-normal text-zinc-600">(optional)</span>
        </label>
        <input
          type="date"
          value={form.next_renewal}
          onChange={(e) => set('next_renewal', e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
        />
      </div>

      <div className="flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5">
        <span className="text-sm text-white">Auto-renews</span>
        <button
          type="button"
          onClick={() => set('auto_renews', !form.auto_renews)}
          className={`relative h-6 w-11 overflow-hidden rounded-full transition-colors ${
            form.auto_renews ? 'bg-emerald-500' : 'bg-zinc-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              form.auto_renews ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Category <span className="normal-case font-normal text-zinc-600">(optional)</span>
        </label>
        <select
          value={form.category}
          onChange={(e) => set('category', e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-white focus:outline-none focus:ring-1 focus:ring-zinc-500"
        >
          <option value="">None</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 active:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 rounded-xl bg-white py-3 text-sm font-bold text-black disabled:opacity-50"
        >
          {isPending ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

// ─── Import Sheet ─────────────────────────────────────────────────────────────

type ImportState =
  | { status: 'analyzing' }
  | { status: 'review'; items: ImportedSubscription[]; included: boolean[] }
  | { status: 'error'; message: string }

function ImportSheet({
  state,
  onToggle,
  onConfirm,
  onClose,
  isAdding,
}: {
  state: ImportState
  onToggle: (idx: number) => void
  onConfirm: () => void
  onClose: () => void
  isAdding: boolean
}) {
  const selectedCount =
    state.status === 'review' ? state.included.filter(Boolean).length : 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      onClick={(e) => { if (e.target === e.currentTarget && state.status !== 'analyzing') onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-5 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Import from screenshot
          </h2>
          {state.status !== 'analyzing' && (
            <button onClick={onClose} className="text-zinc-500 active:text-white">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {state.status === 'analyzing' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
            <p className="text-sm text-zinc-400">Reading your screenshot…</p>
          </div>
        )}

        {state.status === 'error' && (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm text-zinc-400">{state.message}</p>
            <button
              onClick={onClose}
              className="w-full rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 active:bg-zinc-800"
            >
              Close
            </button>
          </div>
        )}

        {state.status === 'review' && state.items.length === 0 && (
          <div className="space-y-4 py-4 text-center">
            <p className="text-sm text-zinc-400">
              No subscriptions found in that screenshot. Try one that shows the
              service name and price — a receipt, confirmation email, or billing page.
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 active:bg-zinc-800"
            >
              Close
            </button>
          </div>
        )}

        {state.status === 'review' && state.items.length > 0 && (
          <>
            <p className="text-xs text-zinc-500">
              Found {state.items.length} subscription{state.items.length === 1 ? '' : 's'}.
              Tap to include or exclude, then add.
            </p>
            <div className="space-y-2">
              {state.items.map((item, idx) => {
                const included = state.included[idx]
                const periodLabel = item.billing_period === 'monthly' ? '/month' :
                  item.billing_period === 'yearly' ? '/year' : '/week'
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onToggle(idx)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      included
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-zinc-800 bg-zinc-800/40 opacity-50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                        included ? 'border-emerald-400 bg-emerald-500/20' : 'border-zinc-600'
                      }`}
                    >
                      {included && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3 text-emerald-400">
                          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{item.name}</span>
                      <span className="block text-xs text-zinc-500">
                        {formatAmount(item.amount, item.currency)}{periodLabel}
                        {item.next_renewal ? ` · renews ${shortDateLabel(item.next_renewal)}` : ''}
                      </span>
                    </span>
                    {item.category && (
                      <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
                        {item.category}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-xl border border-zinc-700 py-3 text-sm font-medium text-zinc-400 active:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isAdding || selectedCount === 0}
                className="flex-1 rounded-xl bg-white py-3 text-sm font-bold text-black disabled:opacity-50"
              >
                {isAdding ? 'Adding…' : `Add ${selectedCount}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Edit Sheet ───────────────────────────────────────────────────────────────

function EditSheet({
  sub,
  onClose,
}: {
  sub: Subscription
  onClose: () => void
}) {
  const updateSubscription = useUpdateSubscription()

  const initial: FormState = {
    name: sub.name,
    amount: sub.amount.toString(),
    currency: sub.currency,
    billing_period: sub.billing_period,
    next_renewal: sub.next_renewal ?? '',
    auto_renews: sub.auto_renews,
    category: sub.category ?? '',
  }

  function handleSubmit(form: FormState) {
    const updates: UpdateSubscriptionPayload = {
      name: form.name.trim(),
      amount: parseFloat(form.amount),
      currency: form.currency,
      billing_period: form.billing_period,
      next_renewal: form.next_renewal || null,
      auto_renews: form.auto_renews,
      category: form.category || null,
    }
    updateSubscription.mutate({ id: sub.id, updates }, { onSuccess: onClose })
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 p-5 space-y-4 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Edit subscription
          </h2>
          <button onClick={onClose} className="text-zinc-500 active:text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <SubscriptionForm
          initial={initial}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitLabel="Save"
          isPending={updateSubscription.isPending}
        />
      </div>
    </div>
  )
}

// ─── Subscription Row ─────────────────────────────────────────────────────────

function SubscriptionRow({
  sub,
  onEdit,
}: {
  sub: SubscriptionWithMeta
  onEdit: (s: Subscription) => void
}) {
  const deleteSubscription = useDeleteSubscription()
  const updateSubscription = useUpdateSubscription()
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleDelete() {
    deleteSubscription.mutate(sub.id, { onSuccess: () => setConfirmDelete(false) })
  }

  // Show "mark paid" once a dated subscription reaches or passes its renewal day.
  const isDueOrOverdue = sub.next_renewal !== null && sub.daysUntilRenewal !== null && sub.daysUntilRenewal <= 0
  const rolledRenewal = sub.next_renewal ? nextRenewalAfterPayment(sub.next_renewal, sub.billing_period) : null

  function handleMarkPaid() {
    if (!rolledRenewal) return
    updateSubscription.mutate({ id: sub.id, updates: { next_renewal: rolledRenewal } })
  }

  const periodLabel = sub.billing_period === 'monthly' ? '/month' :
    sub.billing_period === 'yearly' ? '/year' : '/week'

  return (
    <div
      className={`mb-2 rounded-2xl p-4 transition-colors ${
        sub.isUrgent
          ? 'border border-red-500/30 bg-red-500/10'
          : 'bg-zinc-900'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-white">{sub.name}</p>
          <p className="text-xs text-zinc-500">{sub.billing_period.charAt(0).toUpperCase() + sub.billing_period.slice(1)}</p>
          {sub.category && (
            <span className="mt-1 inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
              {sub.category}
            </span>
          )}
          {sub.next_renewal && (
            <p className={`mt-1 text-xs ${sub.isUrgent ? 'text-red-400' : 'text-amber-400'}`}>
              ↻ {formatRenewalLabel(sub.next_renewal)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="text-right">
            <p className={`text-base font-bold ${sub.isUrgent ? 'text-red-400' : 'text-emerald-400'}`}>
              {formatAmount(sub.amount, sub.currency)}
            </p>
            <p className="text-[10px] text-zinc-500">{periodLabel}</p>
            {sub.billing_period !== 'monthly' && (
              <p className="text-[10px] text-zinc-600">
                {formatAmount(sub.monthlyEquivalent, sub.currency)}/mo
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(sub)}
              className="rounded-lg p-1.5 text-zinc-500 active:text-white"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg p-1.5 text-zinc-500 active:text-red-400"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isDueOrOverdue && !confirmDelete && (
        <button
          onClick={handleMarkPaid}
          disabled={updateSubscription.isPending}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-xs font-semibold text-emerald-400 active:bg-emerald-500/20 disabled:opacity-50"
        >
          {updateSubscription.isPending ? (
            'Updating…'
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Mark paid{rolledRenewal ? ` · rolls to ${shortDateLabel(rolledRenewal)}` : ''}
            </>
          )}
        </button>
      )}

      {confirmDelete && (
        <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3">
          <p className="flex-1 text-xs text-zinc-400">Delete this subscription?</p>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 active:text-white"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleteSubscription.isPending}
            className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400 active:bg-red-500/30 disabled:opacity-50"
          >
            {deleteSubscription.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SubscriptionsClient({
  initialSubscriptions,
}: {
  initialSubscriptions: Subscription[]
}) {
  const { data: subscriptions } = useSubscriptions()
  const createSubscription = useCreateSubscription()
  const analyzeScreenshot = useAnalyzeSubscriptionScreenshot()

  const [showAddForm, setShowAddForm] = useState(false)
  const [editingSub, setEditingSub] = useState<Subscription | null>(null)
  const [importState, setImportState] = useState<ImportState | null>(null)
  const [isAddingImports, setIsAddingImports] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const allSubs = subscriptions ?? initialSubscriptions
  const enriched = allSubs.map(enrichSubscription)
  const sorted = sortSubscriptions(enriched)

  function handleCreate(form: FormState) {
    const payload: CreateSubscriptionPayload = {
      name: form.name.trim(),
      amount: parseFloat(form.amount),
      currency: form.currency,
      billing_period: form.billing_period,
      next_renewal: form.next_renewal || null,
      auto_renews: form.auto_renews,
      category: form.category || null,
    }
    createSubscription.mutate(payload, {
      onSuccess: () => {
        setShowAddForm(false)
      },
    })
  }

  async function importFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setImportState({ status: 'error', message: 'That file is not an image. Drop a screenshot instead.' })
      return
    }
    setImportState({ status: 'analyzing' })
    try {
      const payload = await fileToBase64Image(file)
      const { subscriptions: items } = await analyzeScreenshot.mutateAsync(payload)
      setImportState({ status: 'review', items, included: items.map(() => true) })
    } catch {
      setImportState({
        status: 'error',
        message: 'Could not read that screenshot. Try again with a clearer image.',
      })
    }
  }

  // Keep a ref so the window drag listeners (bound once) always call the latest closure
  const importFileRef = useRef(importFile)
  importFileRef.current = importFile

  function handleScreenshotPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) importFile(file)
  }

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    function onDragEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      dragDepth.current++
      setIsDragging(true)
    }
    function onDragLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setIsDragging(false)
    }
    function onDragOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault()
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth.current = 0
      setIsDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (file) importFileRef.current(file)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  function toggleImportItem(idx: number) {
    setImportState((s) => {
      if (!s || s.status !== 'review') return s
      const included = [...s.included]
      included[idx] = !included[idx]
      return { ...s, included }
    })
  }

  async function confirmImport() {
    if (!importState || importState.status !== 'review') return
    const selected = importState.items.filter((_, i) => importState.included[i])
    if (selected.length === 0) return
    setIsAddingImports(true)
    try {
      for (const item of selected) {
        await createSubscription.mutateAsync({
          name: item.name,
          amount: item.amount,
          currency: item.currency,
          billing_period: item.billing_period,
          next_renewal: item.next_renewal,
          auto_renews: true,
          category: item.category,
        })
      }
      setImportState(null)
    } catch {
      setImportState({
        status: 'error',
        message: 'Some subscriptions failed to save. Check the list and re-import the rest.',
      })
    } finally {
      setIsAddingImports(false)
    }
  }

  return (
    <div className="min-h-screen bg-black pb-24">
      <div className="mx-auto max-w-md px-4 pt-12">
        <h1 className="mb-4 text-2xl font-bold text-white">Subscriptions</h1>

        {!showAddForm && (
          <div className="mb-4 flex gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white active:bg-zinc-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4.5 w-4.5">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="12" cy="13" r="4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Import
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-sm font-semibold text-white active:bg-zinc-800"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4.5 w-4.5">
                <path d="M12 5v14M5 12h14" strokeLinecap="round" />
              </svg>
              Add
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleScreenshotPicked}
        />

        {enriched.length > 0 && <RenewalTicker subs={enriched} />}

        {allSubs.length > 0 && <SummaryCard subs={enriched} />}

        {showAddForm && (
          <div className="mb-4 rounded-2xl bg-zinc-900 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
              New subscription
            </p>
            <SubscriptionForm
              initial={defaultForm}
              onSubmit={handleCreate}
              onCancel={() => setShowAddForm(false)}
              submitLabel="Add"
              isPending={createSubscription.isPending}
            />
          </div>
        )}

        {sorted.length === 0 && !showAddForm ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <span className="mb-3 text-4xl">💳</span>
            <p className="font-semibold text-white">No subscriptions tracked yet</p>
            <p className="mt-1 text-sm text-zinc-500">Add one manually, import a receipt screenshot, or drag one in</p>
          </div>
        ) : (
          <div>
            {sorted.length > 0 && (
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                All subscriptions
              </p>
            )}
            {sorted.map((sub) => (
              <SubscriptionRow
                key={sub.id}
                sub={sub}
                onEdit={setEditingSub}
              />
            ))}
          </div>
        )}
      </div>

      {editingSub && (
        <EditSheet sub={editingSub} onClose={() => setEditingSub(null)} />
      )}

      {importState && (
        <ImportSheet
          state={importState}
          onToggle={toggleImportItem}
          onConfirm={confirmImport}
          onClose={() => setImportState(null)}
          isAdding={isAddingImports}
        />
      )}

      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-emerald-400/60 bg-emerald-500/5 px-6 py-12">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-emerald-400">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="13" r="4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-base font-semibold text-white">Drop screenshot to import</p>
            <p className="text-sm text-zinc-400">Receipts, App Store pages, statements</p>
          </div>
        </div>
      )}
    </div>
  )
}
