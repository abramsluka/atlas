'use client'

import { useState, useRef } from 'react'
import { useFoodLogs, useFoodHistory } from '@/features/food/queries'
import { useUpdateFoodLog, useDeleteFoodLog, useRepeatFoodLog } from '@/features/food/mutations'
import type { FoodLog } from '@/features/food/types'

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
        <input className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40" placeholder="Meal name" value={name} onChange={e => setName(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: 'Cal', val: calories, set: setCalories },
            { label: 'Protein (g)', val: protein, set: setProtein },
            { label: 'Carbs (g)', val: carbs, set: setCarbs },
          ].map(({ label, val, set }) => (
            <div key={label}>
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</label>
              <input type="number" inputMode="decimal" min="0" placeholder="0" onFocus={e => e.target.select()} className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-white/40" value={val} onChange={e => set(e.target.value)} />
            </div>
          ))}
        </div>
        <textarea className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40 resize-none" placeholder="Notes (optional)" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-white/[0.12] py-3 text-sm font-semibold text-zinc-400">Cancel</button>
          <button
            onClick={() => onSave({
              item_name: name.trim() || meal.item_name,
              calories: calories ? parseInt(calories) : meal.calories,
              protein_g: protein ? parseFloat(protein) : meal.protein_g,
              carbs_g: carbs ? parseFloat(carbs) : meal.carbs_g,
              notes: notes.trim() || null,
            })}
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

function CalSparkline({ history }: { history: { date: string; calories: number }[] }) {
  const reversed = [...history].reverse()
  const values = reversed.map(h => h.calories)
  if (values.length < 2) return <div className="h-8 w-full" />
  const max = Math.max(...values, 1)
  const w = 100
  const h = 32
  const step = w / (values.length - 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-8 w-full">
      <polyline points={points} fill="none" stroke="#6ee7b7" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function FoodHistoryClient({
  initialLogs,
  today,
}: {
  initialLogs: FoodLog[]
  today: string
}) {
  const [selectedDate, setSelectedDate] = useState(today)
  const [editingMeal, setEditingMeal] = useState<FoodLog | null>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  function shiftDate(days: number) {
    const d = new Date(selectedDate + 'T12:00:00')
    d.setDate(d.getDate() + days)
    const next = d.toISOString().slice(0, 10)
    if (next <= today) setSelectedDate(next)
  }
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data: meals } = useFoodLogs(selectedDate)
  const { data: history } = useFoodHistory(14)
  const updateMeal = useUpdateFoodLog()
  const deleteMeal = useDeleteFoodLog()
  const repeatMeal = useRepeatFoodLog()
  const [repeatingId, setRepeatingId] = useState<string | null>(null)
  const [addedId, setAddedId] = useState<string | null>(null)

  async function addToToday(meal: FoodLog) {
    if (repeatMeal.isPending) return
    setRepeatingId(meal.id)
    try {
      await repeatMeal.mutateAsync({ id: meal.id })
      setAddedId(meal.id)
      setTimeout(() => setAddedId(prev => (prev === meal.id ? null : prev)), 2000)
    } catch {
      // transient; user can tap again
    } finally {
      setRepeatingId(null)
    }
  }

  const displayMeals = selectedDate === today ? (meals ?? initialLogs) : (meals ?? [])
  const totals = displayMeals.reduce(
    (acc, m) => ({ calories: acc.calories + (m.calories ?? 0), protein_g: acc.protein_g + Number(m.protein_g ?? 0), carbs_g: acc.carbs_g + Number(m.carbs_g ?? 0) }),
    { calories: 0, protein_g: 0, carbs_g: 0 },
  )

  return (
    <main className="min-h-screen px-4 pb-24 pt-14">
      <div className="flex items-center gap-3 mb-5">
        <a href="/health" className="text-zinc-500 text-sm">← Health</a>
        <h1 className="text-xl font-bold text-white">Food history</h1>
      </div>

      {/* Sparkline */}
      {history && history.length > 1 && (
        <div className="mb-4 rounded-xl bg-zinc-900 p-4">
          <p className="mb-2 text-xs text-zinc-500">14-day calories</p>
          <CalSparkline history={history} />
        </div>
      )}

      {/* Date picker */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => shiftDate(-1)}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-zinc-900 text-white/60 active:opacity-60"
        >
          ←
        </button>

        <button
          onClick={() => dateInputRef.current?.showPicker()}
          className="relative flex flex-1 items-center justify-between rounded-xl border border-white/[0.12] bg-zinc-900 px-3 py-2.5 text-left active:opacity-80"
        >
          <span className="text-sm text-white">
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white flex-shrink-0">
            <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M5 1v3M11 1v3M1 7h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={dateInputRef}
            type="date"
            value={selectedDate}
            max={today}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
            tabIndex={-1}
          />
        </button>

        <button
          onClick={() => shiftDate(1)}
          disabled={selectedDate >= today}
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-zinc-900 text-white/60 active:opacity-60 disabled:opacity-25"
        >
          →
        </button>
      </div>

      {/* Day totals */}
      <div className="mb-4 rounded-xl bg-zinc-900 p-4">
        <p className="text-2xl font-bold text-white">{totals.calories.toLocaleString()} cal</p>
        <p className="text-sm text-zinc-400">{Math.round(totals.protein_g)}g protein · {Math.round(totals.carbs_g)}g carbs · {displayMeals.length} meal{displayMeals.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Meal list */}
      <div className="space-y-2">
        {displayMeals.length === 0 && (
          <p className="text-center text-sm text-zinc-600 py-8">No meals logged for this day.</p>
        )}
        {displayMeals.map(meal => (
          <div key={meal.id}>
            {confirmDeleteId === meal.id ? (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-900 px-4 py-3">
                <span className="text-sm text-zinc-400">Delete this meal?</span>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDeleteId(null)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300">Cancel</button>
                  <button
                    onClick={async () => {
                      await deleteMeal.mutateAsync({ id: meal.id, date: selectedDate })
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
                className="flex w-full items-center gap-3 rounded-xl bg-zinc-900 px-4 py-3 cursor-pointer hover:bg-zinc-800 transition-colors"
                onClick={() => setEditingMeal(meal)}
              >
                {meal.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={meal.photo_url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{meal.item_name}</p>
                  <p className="text-xs text-zinc-500">{Math.round(Number(meal.protein_g))}g P · {Math.round(Number(meal.carbs_g))}g C · {new Date(meal.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                  {meal.notes && <p className="text-xs text-zinc-600 mt-0.5">{meal.notes}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm font-bold text-white">{meal.calories?.toLocaleString()} cal</span>
                  <button
                    onClick={e => { e.stopPropagation(); addToToday(meal) }}
                    disabled={repeatMeal.isPending}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50 ${
                      addedId === meal.id
                        ? 'border-emerald-300/40 bg-emerald-300/10 text-emerald-300'
                        : 'border-white/[0.12] bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                    }`}
                  >
                    {addedId === meal.id ? 'Added ✓' : repeatingId === meal.id ? 'Adding…' : selectedDate === today ? 'Repeat' : '+ Today'}
                  </button>
                  <button onClick={e => { e.stopPropagation(); setConfirmDeleteId(meal.id) }} className="text-zinc-600 hover:text-red-400 transition-colors text-base px-1">×</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {editingMeal && (
        <MealEditSheet
          meal={editingMeal}
          onSave={async (updates) => {
            await updateMeal.mutateAsync({ id: editingMeal.id, date: selectedDate, updates })
            setEditingMeal(null)
          }}
          onClose={() => setEditingMeal(null)}
        />
      )}
    </main>
  )
}
