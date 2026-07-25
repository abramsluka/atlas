'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion'
import {
  INGREDIENT_LIBRARY,
  type IngredientCategory,
  type LibraryIngredient,
} from '@/features/food/ingredientLibrary'
import { searchIngredients, type SearchHit } from '@/features/food/ingredientSearch'
import {
  defaultGrams,
  fromLibrary,
  fromUserIngredient,
  macrosFor,
  mealTotals,
} from '@/features/food/mealMath'
import { useSavedMeals, useUserIngredients } from '@/features/food/queries'
import {
  useCreateIngredient,
  useDeleteIngredient,
  useDeleteSavedMeal,
  useLogMeal,
  useUpdateIngredient,
  useUpdateSavedMeal,
} from '@/features/food/mutations'
import type { BarcodeLookup, MealIngredient, SavedMeal, UserIngredient } from '@/features/food/types'
import { formatAmount, nextUnit, toGrams, type AmountUnit } from '@/features/food/units'
import { BarcodeScannerOverlay } from './FoodEntry'

// ─── Motion vocabulary ────────────────────────────────────────────────────────
// One spring for structure, one for numbers — everything in the builder speaks
// the same physics so the whole sheet feels like a single object.

// Structure spring: eased down from 420 so rows settle a touch slower and calmer,
// but still snappy — the tray add/remove feel Luka liked stays intact.
const SPRING = { type: 'spring', stiffness: 360, damping: 34, mass: 1 } as const
// Sheet entrance — left as-is; the drawer glide is the one Luka loved.
const SHEET_SPRING = { type: 'spring', stiffness: 300, damping: 32 } as const

export type MealSavedResult = {
  water_logged: boolean
  volume_oz: number | null
  caffeine_logged?: boolean
  caffeine_mg?: number
  id?: string
}

// ─── Animated number (spring count-up) ────────────────────────────────────────

function AnimatedNumber({
  value,
  className,
  decimals = 0,
}: {
  value: number
  className?: string
  decimals?: number
}) {
  const spring = useSpring(value, { stiffness: 240, damping: 30 })
  useEffect(() => {
    spring.set(value)
  }, [value, spring])
  const display = useTransform(spring, v =>
    decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()
  )
  return <motion.span className={className}>{display}</motion.span>
}

// ─── Tray row model ───────────────────────────────────────────────────────────

interface TrayRow {
  key: string
  ing: MealIngredient
}

function amountLabel(ing: MealIngredient): string {
  const suffix = ing.liquid ? 'ml' : 'g'
  if (ing.unit_grams && ing.unit_name) {
    const count = ing.grams / ing.unit_grams
    const rounded = Math.round(count * 10) / 10
    if (rounded >= 0.25) {
      const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
      return `${label} ${ing.unit_name}${rounded === 1 ? '' : 's'} · ${Math.round(ing.grams)}${suffix}`
    }
  }
  return `${Math.round(ing.grams)}${suffix}`
}

function stepFor(ing: MealIngredient): number {
  if (ing.unit_grams && ing.unit_grams > 0) return ing.unit_grams
  return ing.liquid ? 60 : 25
}

// ─── Totals bar ───────────────────────────────────────────────────────────────

function TotalsBar({ rows }: { rows: TrayRow[] }) {
  const totals = useMemo(() => mealTotals(rows.map(r => r.ing)), [rows])
  const proteinCal = totals.protein * 4
  const carbsCal = totals.carbs * 4
  const otherCal = Math.max(0, totals.cal - proteinCal - carbsCal)
  const denom = Math.max(1, proteinCal + carbsCal + otherCal)

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SPRING}
      className="rounded-2xl border border-white/[0.10] bg-white/[0.045] px-4 py-3"
    >
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-1.5">
          <AnimatedNumber value={totals.cal} className="text-2xl font-bold text-white tabular-nums" />
          <span className="text-xs text-zinc-500">cal</span>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-emerald-300">
            <AnimatedNumber value={totals.protein} />g P
          </span>
          <span className="text-sky-300">
            <AnimatedNumber value={totals.carbs} />g C
          </span>
          <span className="text-zinc-500">
            <AnimatedNumber value={totals.grams} />g
          </span>
        </div>
      </div>
      {/* Macro split: protein / carbs / everything-else calories */}
      <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          className="h-full bg-emerald-400/80"
          animate={{ width: `${(proteinCal / denom) * 100}%` }}
          transition={SPRING}
        />
        <motion.div
          className="h-full bg-sky-400/80"
          animate={{ width: `${(carbsCal / denom) * 100}%` }}
          transition={SPRING}
        />
        <motion.div
          className="h-full bg-zinc-600/60"
          animate={{ width: `${(otherCal / denom) * 100}%` }}
          transition={SPRING}
        />
      </div>
      {(totals.volume_oz != null || totals.caffeine_mg > 0) && (
        <div className="mt-2 flex gap-3">
          {totals.volume_oz != null && (
            <span className="text-[10px] text-sky-300/80">+{totals.volume_oz} oz water</span>
          )}
          {totals.caffeine_mg > 0 && (
            <span className="text-[10px] text-amber-300/80">+{totals.caffeine_mg} mg caffeine</span>
          )}
        </div>
      )}
    </motion.div>
  )
}

// ─── Tray row (swipe to delete, inline portion editing) ──────────────────────

function TrayRowView({
  row,
  editing,
  onEdit,
  onChangeGrams,
  onRemove,
}: {
  row: TrayRow
  editing: boolean
  onEdit: (open: boolean) => void
  onChangeGrams: (grams: number) => void
  onRemove: () => void
}) {
  const { ing } = row
  const m = macrosFor(ing)
  const [draft, setDraft] = useState('')
  const [unit, setUnit] = useState<AmountUnit>(ing.liquid ? 'ml' : 'g')
  const reduced = useReducedMotion()
  const step = stepFor(ing)

  function commitDraft() {
    const g = toGrams(Number(draft), unit)
    if (Number.isFinite(g) && g > 0) {
      onChangeGrams(Math.min(10000, g))
      setDraft('')
      onEdit(false)
    }
  }

  const presets = ing.unit_grams && ing.unit_name
    ? [1, 2, 3, 4].map(n => ({ label: `${n} ${ing.unit_name}${n === 1 ? '' : 's'}`, grams: n * ing.unit_grams! }))
    : ing.liquid
      ? [120, 240, 355, 500].map(v => ({ label: `${v}ml`, grams: v }))
      : [50, 100, 150, 250].map(v => ({ label: `${v}g`, grams: v }))

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -64, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={SPRING}
      className="relative"
    >
      {/* delete affordance revealed under the row while dragging */}
      <div className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-xl text-red-400/80">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
      </div>
      <motion.div
        drag={reduced ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.35, right: 0.05 }}
        dragDirectionLock
        onDragEnd={(_, info) => {
          if (info.offset.x < -70) onRemove()
        }}
        className="relative rounded-xl border border-white/[0.09] bg-[#17171a] px-3 py-2.5"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base leading-none">{ing.emoji ?? '📦'}</span>
          <button onClick={() => onEdit(!editing)} className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-semibold text-white">{ing.name}</p>
            <p className="text-[10px] text-zinc-500 tabular-nums">
              {amountLabel(ing)} · {Math.round(m.protein)}g P · {Math.round(m.carbs)}g C
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onChangeGrams(Math.max(step >= 20 ? step : 5, ing.grams - step))}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.10] bg-white/[0.04] text-zinc-300 active:scale-90 transition-transform"
            >
              −
            </button>
            {/* Tap the amount to rotate the display unit: g → ml → oz → lb */}
            <button
              onClick={() => setUnit(nextUnit(unit))}
              className="min-w-[3.4rem] rounded-lg bg-white/[0.05] px-1.5 py-1.5 text-center text-xs font-bold text-white tabular-nums"
            >
              {formatAmount(ing.grams, unit)}
              <span className="font-normal text-zinc-500">{unit}</span>
            </button>
            <button
              onClick={() => onChangeGrams(ing.grams + step)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.10] bg-white/[0.04] text-zinc-300 active:scale-90 transition-transform"
            >
              +
            </button>
          </div>
          <AnimatedNumber
            value={m.cal}
            className="w-12 shrink-0 text-right text-sm font-bold text-white tabular-nums"
          />
        </div>

        <AnimatePresence initial={false}>
          {editing && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-1.5 pt-2.5">
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => onChangeGrams(p.grams)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                      Math.abs(ing.grams - p.grams) < 0.5
                        ? 'border-emerald-300/60 bg-emerald-300/10 text-white'
                        : 'border-white/[0.10] bg-white/[0.03] text-zinc-400'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitDraft()
                    }}
                    placeholder={unit}
                    className="w-14 rounded-lg border border-white/[0.10] bg-black/30 px-2 py-1.5 text-[11px] text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
                  />
                  <button
                    onClick={() => setUnit(nextUnit(unit))}
                    className="rounded-lg border border-white/[0.10] bg-white/[0.03] px-2 py-1.5 text-[11px] text-zinc-300 tabular-nums"
                  >
                    {unit}
                  </button>
                  <button
                    onClick={commitDraft}
                    className="rounded-lg bg-white/[0.07] px-2 py-1.5 text-[11px] text-zinc-300"
                  >
                    Set
                  </button>
                </div>
                <button
                  onClick={onRemove}
                  className="ml-auto rounded-lg px-2 py-1.5 text-[11px] text-red-400/80 active:opacity-70"
                >
                  Remove
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// ─── Search results ───────────────────────────────────────────────────────────

const KIND_BADGE: Record<SearchHit['kind'], { label: string; cls: string }> = {
  meal: { label: 'MEAL', cls: 'text-violet-300 border-violet-300/30 bg-violet-300/10' },
  custom: { label: 'MINE', cls: 'text-amber-300 border-amber-300/30 bg-amber-300/10' },
  library: { label: '', cls: '' },
}

function hitMacroHint(hit: SearchHit): string {
  if (hit.kind === 'meal') {
    return `${hit.item.calories} cal · ${Math.round(Number(hit.item.protein_g))}g P`
  }
  if (hit.kind === 'custom') {
    const i = hit.item
    if (Number(i.unit_grams) > 0) {
      const perServing = Math.round((Number(i.cal_per_100) * Number(i.unit_grams)) / 100)
      return `${perServing} cal / ${i.unit_name || 'serving'}`
    }
    return `${Math.round(Number(i.cal_per_100))} cal / 100${i.liquid ? 'ml' : 'g'}`
  }
  const i = hit.item
  const unit = i.units?.[0]
  const base = `${i.per100.cal} cal / 100${i.liquid ? 'ml' : 'g'}`
  return unit ? `${base} · 1 ${unit.name} = ${unit.grams}${i.liquid ? 'ml' : 'g'}` : base
}

const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: SPRING },
}

function SearchResults({
  hits,
  onPick,
  onEditCustom,
}: {
  hits: SearchHit[]
  onPick: (hit: SearchHit) => void
  onEditCustom: (ing: UserIngredient) => void
}) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={{ show: { transition: { staggerChildren: reduced ? 0 : 0.05 } } }}
      className="space-y-1"
    >
      {hits.map(hit => {
        const badge = KIND_BADGE[hit.kind]
        const emoji = hit.kind === 'library' ? hit.item.emoji : hit.kind === 'meal' ? (hit.item.emoji ?? '🍽') : '📦'
        const body = (
          <>
            <span className="text-base leading-none">{emoji}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {hit.item.name}
                {hit.kind === 'custom' && hit.item.brand ? (
                  <span className="text-zinc-500"> · {hit.item.brand}</span>
                ) : null}
              </p>
              <p className="text-[10px] text-zinc-500 tabular-nums">{hitMacroHint(hit)}</p>
            </div>
            {badge.label && (
              <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold tracking-wider ${badge.cls}`}>
                {badge.label}
              </span>
            )}
          </>
        )

        // Custom foods carry an inline edit pencil, so the row is a container
        // with two sibling buttons rather than one big button.
        if (hit.kind === 'custom') {
          return (
            <motion.div
              key={`${hit.kind}:${hit.item.id}`}
              variants={ROW_VARIANTS}
              className="flex items-center rounded-xl border border-white/[0.07] bg-white/[0.025]"
            >
              <button
                onClick={() => onPick(hit)}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-l-xl px-3 py-2.5 text-left active:bg-white/[0.06]"
              >
                {body}
                <span className="shrink-0 text-zinc-600">＋</span>
              </button>
              <button
                onClick={() => onEditCustom(hit.item)}
                aria-label={`Edit ${hit.item.name}`}
                className="shrink-0 self-stretch rounded-r-xl border-l border-white/[0.07] px-3 text-zinc-500 active:bg-white/[0.06]"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </button>
            </motion.div>
          )
        }

        return (
          <motion.button
            key={`${hit.kind}:${hit.item.id}`}
            variants={ROW_VARIANTS}
            whileTap={{ scale: 0.98 }}
            onClick={() => onPick(hit)}
            className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5 text-left active:bg-white/[0.06]"
          >
            {body}
            <span className="shrink-0 text-zinc-600">＋</span>
          </motion.button>
        )
      })}
    </motion.div>
  )
}

// ─── Saved meal card (empty state) ────────────────────────────────────────────

function SavedMealCard({
  meal,
  onLoad,
  onEdit,
  onQuickLog,
  logging,
  onDelete,
}: {
  meal: SavedMeal
  onLoad: () => void
  onEdit: () => void
  onQuickLog: () => void
  logging: boolean
  onDelete: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={SPRING}
      className="w-44 shrink-0 rounded-2xl border border-white/[0.09] bg-white/[0.035] p-3"
    >
      <button onClick={onLoad} className="block w-full text-left">
        <div className="flex items-start justify-between">
          <span className="text-xl leading-none">{meal.emoji ?? '🍽'}</span>
          <div className="-mr-1 -mt-1 flex items-center gap-0.5">
            <button
              onClick={e => {
                e.stopPropagation()
                onEdit()
              }}
              aria-label={`Edit ${meal.name}`}
              className="px-1 py-0.5 text-zinc-600 active:text-zinc-300"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              onClick={e => {
                e.stopPropagation()
                if (confirm) onDelete()
                else {
                  setConfirm(true)
                  setTimeout(() => setConfirm(false), 2500)
                }
              }}
              className={`px-1.5 py-0.5 text-xs transition-colors ${confirm ? 'text-red-400' : 'text-zinc-600'}`}
            >
              {confirm ? 'sure?' : '×'}
            </button>
          </div>
        </div>
        <p className="mt-1.5 truncate text-sm font-semibold text-white">{meal.name}</p>
        <p className="text-[10px] text-zinc-500 tabular-nums">
          {meal.calories} cal · {Math.round(Number(meal.protein_g))}g P · {meal.ingredients.length} items
        </p>
      </button>
      <motion.button
        whileTap={{ scale: 0.95 }}
        onClick={onQuickLog}
        disabled={logging}
        className="mt-2.5 w-full rounded-lg py-1.5 text-xs font-semibold text-black disabled:opacity-50"
        style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
      >
        {logging ? 'Logging…' : 'Log again'}
      </motion.button>
    </motion.div>
  )
}

// ─── Category browser (empty-search discovery) ───────────────────────────────

const CATEGORIES: { key: IngredientCategory; label: string; emoji: string }[] = [
  { key: 'protein', label: 'Protein', emoji: '🥩' },
  { key: 'carb', label: 'Carbs', emoji: '🍚' },
  { key: 'drink', label: 'Drinks', emoji: '🥤' },
  { key: 'fruit', label: 'Fruit', emoji: '🍓' },
  { key: 'veg', label: 'Veggies', emoji: '🥦' },
  { key: 'dairy', label: 'Dairy', emoji: '🧀' },
  { key: 'fat', label: 'Fats', emoji: '🥜' },
  { key: 'snack', label: 'Snacks', emoji: '🍫' },
  { key: 'condiment', label: 'Sauces', emoji: '🍯' },
]

function CategoryBrowser({ onPick }: { onPick: (ing: LibraryIngredient) => void }) {
  const [open, setOpen] = useState<IngredientCategory | null>(null)
  const items = useMemo(
    () => (open ? INGREDIENT_LIBRARY.filter(i => i.category === open) : []),
    [open]
  )
  const reduced = useReducedMotion()

  return (
    <div className="space-y-2">
      <div className="-mx-1 overflow-x-auto">
        <div className="flex w-max gap-1.5 px-1 pb-0.5">
          {CATEGORIES.map(c => (
            <motion.button
              key={c.key}
              whileTap={{ scale: 0.94 }}
              onClick={() => setOpen(open === c.key ? null : c.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                open === c.key
                  ? 'border-emerald-300/50 bg-emerald-300/10 text-white'
                  : 'border-white/[0.09] bg-white/[0.03] text-zinc-400'
              }`}
            >
              <span>{c.emoji}</span>
              {c.label}
            </motion.button>
          ))}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key={open}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: reduced ? 0 : 0.012 } } }}
              className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto pr-1"
            >
              {items.map(i => (
                <motion.button
                  key={i.id}
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: SPRING } }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => onPick(i)}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left active:bg-white/[0.06]"
                >
                  <span className="text-sm leading-none">{i.emoji}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-white">{i.name}</p>
                    <p className="text-[9px] text-zinc-600 tabular-nums">
                      {i.per100.cal} cal/100{i.liquid ? 'ml' : 'g'}
                    </p>
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Create / edit custom ingredient (manual / barcode-not-found) ────────────
// The label is entered the way food labels actually read: everything is "per
// serving" (cal + macros for one serving) plus how many grams a serving weighs.
// We convert to the per-100g the rest of the app scales on, right before saving.

const round1 = (n: number) => Math.round(n * 10) / 10

function CreateIngredientForm({
  editing,
  prefill,
  onCancel,
  onCreated,
  onSaved,
}: {
  editing: UserIngredient | null
  prefill: { name?: string; barcode?: string | null }
  onCancel: () => void
  onCreated: (ing: UserIngredient) => void
  onSaved: () => void
}) {
  const create = useCreateIngredient()
  const update = useUpdateIngredient()
  const remove = useDeleteIngredient()

  // Existing foods store per-100g. Convert back to per-serving for the form,
  // falling back to a 100g serving for older foods saved without a unit.
  const editServing = editing && Number(editing.unit_grams) > 0 ? Number(editing.unit_grams) : 100
  const backToServing = (per100: number) => {
    const v = round1((Number(per100) * editServing) / 100)
    return v > 0 ? String(v) : ''
  }

  const [name, setName] = useState(editing?.name ?? prefill.name ?? '')
  const [cal, setCal] = useState(editing ? backToServing(editing.cal_per_100) : '')
  const [protein, setProtein] = useState(editing ? backToServing(editing.protein_per_100) : '')
  const [carbs, setCarbs] = useState(editing ? backToServing(editing.carbs_per_100) : '')
  const [unitName, setUnitName] = useState(editing?.unit_name ?? 'serving')
  const [servingGrams, setServingGrams] = useState(
    editing && Number(editing.unit_grams) > 0 ? String(Number(editing.unit_grams)) : ''
  )
  const [liquid, setLiquid] = useState(editing?.liquid ?? false)
  const [hydrating, setHydrating] = useState(editing?.hydrating ?? false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const servingG = Number(servingGrams)
  const valid =
    name.trim() !== '' && servingG > 0 && cal !== '' && Number.isFinite(Number(cal)) && Number(cal) >= 0

  // Live preview of the per-100g the app will actually store — this is the
  // "autocalculate" made visible, so the number is never a mystery.
  const per100Preview =
    servingG > 0 && cal !== '' ? Math.round((Number(cal) * 100) / servingG) : null

  async function submit() {
    if (!valid) return
    setError(null)
    const per = 100 / servingG
    const macros = {
      cal_per_100: Math.min(1000, round1(Number(cal) * per)),
      protein_per_100: Math.min(100, round1((Number(protein) || 0) * per)),
      carbs_per_100: Math.min(100, round1((Number(carbs) || 0) * per)),
      unit_name: unitName.trim() || 'serving',
      unit_grams: round1(servingG),
      liquid,
      hydrating: liquid && hydrating,
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, name: name.trim(), ...macros })
        onSaved()
      } else {
        const created = await create.mutateAsync({
          name: name.trim(),
          barcode: prefill.barcode ?? null,
          ...macros,
        })
        onCreated(created)
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  async function del() {
    if (!editing) return
    if (!confirmDel) {
      setConfirmDel(true)
      setTimeout(() => setConfirmDel(false), 2500)
      return
    }
    setError(null)
    try {
      await remove.mutateAsync({ id: editing.id })
      onSaved()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  const inputCls =
    'w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30'
  const unitWord = unitName.trim() || 'serving'
  const pending = create.isPending || update.isPending

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={SPRING}
      className="space-y-3"
    >
      <p className="text-sm font-semibold text-white">{editing ? 'Edit food' : 'New food'}</p>
      {!editing && prefill.barcode && (
        <p className="text-[10px] text-zinc-500">
          Barcode {prefill.barcode} — enter the serving info off the label once, it&apos;s math forever after.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" autoFocus className={inputCls} />

      {/* Serving definition — "1 serving = N grams" */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <input value={unitName} onChange={e => setUnitName(e.target.value)} placeholder="serving" className={inputCls} />
          <p className="mt-1 text-center text-[9px] text-zinc-600">unit name</p>
        </div>
        <div>
          <input type="number" inputMode="decimal" value={servingGrams} onChange={e => setServingGrams(e.target.value)} placeholder="0" className={inputCls} />
          <p className="mt-1 text-center text-[9px] text-zinc-600">{liquid ? 'ml' : 'grams'} / {unitWord}</p>
        </div>
      </div>

      {/* Per-serving macros */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <input type="number" inputMode="decimal" value={cal} onChange={e => setCal(e.target.value)} placeholder="0" className={inputCls} />
          <p className="mt-1 text-center text-[9px] text-zinc-600">cal / {unitWord}</p>
        </div>
        <div>
          <input type="number" inputMode="decimal" value={protein} onChange={e => setProtein(e.target.value)} placeholder="0" className={inputCls} />
          <p className="mt-1 text-center text-[9px] text-zinc-600">protein g</p>
        </div>
        <div>
          <input type="number" inputMode="decimal" value={carbs} onChange={e => setCarbs(e.target.value)} placeholder="0" className={inputCls} />
          <p className="mt-1 text-center text-[9px] text-zinc-600">carbs g</p>
        </div>
      </div>
      {per100Preview != null && (
        <p className="text-center text-[10px] text-zinc-500">≈ {per100Preview} cal / 100{liquid ? 'ml' : 'g'}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setLiquid(!liquid)}
          className={`flex-1 rounded-xl border px-3 py-2 text-xs transition-colors ${
            liquid ? 'border-sky-300/50 bg-sky-300/10 text-white' : 'border-white/[0.10] bg-white/[0.03] text-zinc-400'
          }`}
        >
          💧 Liquid (ml)
        </button>
        {liquid && (
          <button
            onClick={() => setHydrating(!hydrating)}
            className={`flex-1 rounded-xl border px-3 py-2 text-xs transition-colors ${
              hydrating ? 'border-sky-300/50 bg-sky-300/10 text-white' : 'border-white/[0.10] bg-white/[0.03] text-zinc-400'
            }`}
          >
            Counts as water
          </button>
        )}
      </div>

      {editing && (
        <button
          onClick={del}
          disabled={remove.isPending}
          className={`w-full rounded-xl border px-3 py-2 text-xs transition-colors disabled:opacity-50 ${
            confirmDel ? 'border-red-400/50 bg-red-400/10 text-red-300' : 'border-white/[0.09] bg-white/[0.03] text-zinc-500'
          }`}
        >
          {remove.isPending ? 'Deleting…' : confirmDel ? 'Tap again to delete this food' : '🗑 Delete food'}
        </button>
      )}

      <div className="flex gap-2">
        <button onClick={onCancel} className="h-11 flex-1 rounded-xl border border-white/[0.09] bg-white/[0.04] text-sm text-zinc-400">
          {editing ? 'Cancel' : 'Back'}
        </button>
        <button
          onClick={submit}
          disabled={!valid || pending}
          className="h-11 flex-[2] rounded-xl text-sm font-semibold text-black disabled:opacity-40"
          style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
        >
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Add to meal'}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Success burst ────────────────────────────────────────────────────────────

const PARTICLE_ANGLES = [15, 70, 130, 195, 250, 310]

function SuccessBurst({ calories }: { calories: number }) {
  const reduced = useReducedMotion()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-3xl bg-[#111113]/95"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      <div className="relative">
        <motion.div
          initial={{ scale: reduced ? 1 : 0.3 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          className="flex h-20 w-20 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-400/10"
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <motion.path
              d="M4 12.5l5 5L20 6.5"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.12, duration: 0.35, ease: 'easeOut' }}
            />
          </svg>
        </motion.div>
        {!reduced &&
          PARTICLE_ANGLES.map(deg => (
            <motion.span
              key={deg}
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{
                opacity: 0,
                x: Math.cos((deg * Math.PI) / 180) * 56,
                y: Math.sin((deg * Math.PI) / 180) * 56,
                scale: 0.4,
              }}
              transition={{ duration: 0.6, ease: 'easeOut', delay: 0.1 }}
              className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -ml-[3px] -mt-[3px] rounded-full bg-emerald-300"
            />
          ))}
      </div>
      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, ...SPRING }}
        className="text-sm font-semibold text-white"
      >
        +{calories.toLocaleString()} cal logged
      </motion.p>
    </motion.div>
  )
}

// ─── The builder sheet ────────────────────────────────────────────────────────

const SCALES = [0.5, 1, 1.5, 2]

export function MealBuilderSheet({
  onClose,
  onSaved,
  onDescribeWithAI,
}: {
  onClose: () => void
  onSaved: (res: MealSavedResult) => void
  onDescribeWithAI: (description: string) => void
}) {
  const { data: customIngredients } = useUserIngredients()
  const { data: savedMeals } = useSavedMeals()
  const logMeal = useLogMeal()
  const createIngredient = useCreateIngredient()
  const deleteSavedMeal = useDeleteSavedMeal()
  const updateSavedMeal = useUpdateSavedMeal()

  const [rows, setRows] = useState<TrayRow[]>([])
  const [query, setQuery] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [mealName, setMealName] = useState('')
  const [saveAs, setSaveAs] = useState(false)
  const [view, setView] = useState<'build' | 'scan' | 'create'>('build')
  const [createPrefill, setCreatePrefill] = useState<{ name?: string; barcode?: string | null }>({})
  const [editingIngredient, setEditingIngredient] = useState<UserIngredient | null>(null)
  const [editingMealId, setEditingMealId] = useState<string | null>(null)
  const [loadedMeal, setLoadedMeal] = useState<{ id: string; base: MealIngredient[] } | null>(null)
  const [scale, setScale] = useState(1)
  const [quickLogId, setQuickLogId] = useState<string | null>(null)
  const [success, setSuccess] = useState<number | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyCounter = useRef(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const hits = useMemo(
    () => searchIngredients(query, customIngredients ?? [], savedMeals ?? []),
    [query, customIngredients, savedMeals]
  )

  const totals = useMemo(() => mealTotals(rows.map(r => r.ing)), [rows])

  const suggestedName = useMemo(() => {
    if (rows.length === 0) return ''
    const names = rows.slice(0, 3).map(r => r.ing.name.replace(/\s*\(.*?\)\s*/g, '').trim())
    const joined = names.join(' + ')
    return joined.length > 44 ? `${names[0]} + ${rows.length - 1} more` : joined
  }, [rows])

  function addIngredient(ing: MealIngredient) {
    const key = `row-${keyCounter.current++}`
    setRows(prev => [...prev, { key, ing }])
    setEditingKey(key)
    setQuery('')
    navigator.vibrate?.(10)
  }

  function pickHit(hit: SearchHit) {
    if (hit.kind === 'library') {
      addIngredient(fromLibrary(hit.item, defaultGrams({ unit_grams: hit.item.units?.[0]?.grams, liquid: hit.item.liquid })))
    } else if (hit.kind === 'custom') {
      addIngredient(fromUserIngredient(hit.item, defaultGrams(hit.item)))
    } else {
      loadSavedMeal(hit.item)
    }
  }

  function loadSavedMeal(meal: SavedMeal) {
    const base = meal.ingredients.map(i => ({ ...i, per100: { ...i.per100 } }))
    const cleanLoad = rows.length === 0
    setRows(prev => [
      ...prev,
      ...base.map((ing, i) => ({
        key: cleanLoad ? `meal-${meal.id}-${i}` : `row-${keyCounter.current++}`,
        ing: { ...ing },
      })),
    ])
    if (cleanLoad) {
      setLoadedMeal({ id: meal.id, base })
      setMealName(meal.name)
      setScale(1)
    }
    setQuery('')
    setEditingKey(null)
  }

  // Open the create/edit sheet for a custom food.
  function startEditIngredient(ing: UserIngredient) {
    setEditingIngredient(ing)
    setCreatePrefill({ name: ing.name })
    setQuery('')
    setError(null)
    setView('create')
  }

  // Edit a saved recipe: load it into the tray (only reachable from the empty
  // state, so this is always a clean load) and switch the footer into save mode.
  function startEditMeal(meal: SavedMeal) {
    loadSavedMeal(meal)
    setEditingMealId(meal.id)
  }

  function resetBuilder() {
    setRows([])
    setEditingMealId(null)
    setLoadedMeal(null)
    setMealName('')
    setScale(1)
    setQuery('')
    setEditingKey(null)
  }

  async function saveMealEdits() {
    if (!editingMealId || rows.length === 0 || updateSavedMeal.isPending) return
    setError(null)
    try {
      await updateSavedMeal.mutateAsync({
        id: editingMealId,
        name: mealName.trim() || suggestedName || 'Meal',
        ingredients: rows.map(r => r.ing),
      })
      navigator.vibrate?.(15)
      resetBuilder()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  // Rescale only the rows that came from the loaded meal — ingredients the
  // user added on top keep their grams.
  function applyScale(s: number) {
    if (!loadedMeal) return
    setScale(s)
    const prefix = `meal-${loadedMeal.id}-`
    setRows(prev =>
      prev.map(r => {
        if (!r.key.startsWith(prefix)) return r
        const i = Number(r.key.slice(prefix.length))
        const base = loadedMeal.base[i]
        if (!base) return r
        return { ...r, ing: { ...base, grams: Math.round(base.grams * s * 10) / 10 } }
      })
    )
  }

  function changeGrams(key: string, grams: number) {
    setRows(prev => prev.map(r => (r.key === key ? { ...r, ing: { ...r.ing, grams } } : r)))
  }

  function removeRow(key: string) {
    setRows(prev => prev.filter(r => r.key !== key))
    if (editingKey === key) setEditingKey(null)
    navigator.vibrate?.(10)
  }

  async function handleBarcode(code: string) {
    setView('build')
    setScanBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/health/food/barcode/${code}`)
      const json: BarcodeLookup = await res.json()
      if (!json.found) {
        setCreatePrefill({ barcode: code })
        setView('create')
        return
      }
      // Persist to the personal layer so next time it's instant search, no scan
      const created = await createIngredient.mutateAsync({
        name: json.brand ? `${json.name} (${json.brand})` : json.name,
        brand: json.brand,
        barcode: code,
        cal_per_100: Math.min(1000, json.per_100g.calories),
        protein_per_100: Math.min(100, json.per_100g.protein_g),
        carbs_per_100: Math.min(100, json.per_100g.carbs_g),
        unit_name: json.serving_grams ? 'serving' : null,
        unit_grams: json.serving_grams,
      })
      addIngredient(fromUserIngredient(created, json.serving_grams ?? 100))
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    } finally {
      setScanBusy(false)
    }
  }

  async function log() {
    if (rows.length === 0 || logMeal.isPending) return
    setError(null)
    const name = mealName.trim() || suggestedName || 'Meal'
    try {
      const res = await logMeal.mutateAsync({
        name,
        ingredients: rows.map(r => r.ing),
        saved_meal_id: loadedMeal?.id ?? null,
        save_as: saveAs && !loadedMeal ? { name, emoji: rows[0]?.ing.emoji ?? null } : null,
      })
      navigator.vibrate?.([15, 40, 25])
      setSuccess(res.calories ?? totals.cal)
      setTimeout(() => {
        onSaved({
          water_logged: res.water_logged,
          volume_oz: res.volume_oz,
          caffeine_logged: res.caffeine_logged,
          caffeine_mg: res.caffeine_mg,
          id: res.id,
        })
        onClose()
      }, 950)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  async function quickLog(meal: SavedMeal) {
    if (quickLogId) return
    setQuickLogId(meal.id)
    setError(null)
    try {
      const res = await logMeal.mutateAsync({
        name: meal.name,
        ingredients: meal.ingredients,
        saved_meal_id: meal.id,
      })
      navigator.vibrate?.([15, 40, 25])
      setSuccess(res.calories ?? meal.calories)
      setTimeout(() => {
        onSaved({
          water_logged: res.water_logged,
          volume_oz: res.volume_oz,
          caffeine_logged: res.caffeine_logged,
          caffeine_mg: res.caffeine_mg,
          id: res.id,
        })
        onClose()
      }, 950)
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setQuickLogId(null)
    }
  }

  if (view === 'scan') {
    return <BarcodeScannerOverlay onClose={() => setView('build')} onCode={handleBarcode} />
  }

  const showEmptyState = rows.length === 0 && view === 'build' && !editingMealId

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[9vh]">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/70"
        style={{ backdropFilter: 'blur(6px)' }}
        onClick={onClose}
      />
      {/* Top-anchored modal — the top edge (and the search bar with it) is
          locked in place no matter how the content below grows or shrinks.
          Search results float over the body as a dropdown, so nothing shifts. */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.96 }}
        transition={SHEET_SPRING}
        className="relative flex max-h-[82vh] w-full max-w-md flex-col rounded-3xl border border-white/[0.14] bg-[#111113] shadow-2xl shadow-black/60"
      >
        <AnimatePresence>{success != null && <SuccessBurst calories={success} />}</AnimatePresence>

        {/* Header */}
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-base font-bold text-white">
              {editingMealId ? 'Edit recipe' : view === 'create' && editingIngredient ? 'Edit food' : 'Add food'}
            </p>
            <button onClick={onClose} className="text-sm text-zinc-500 active:opacity-60">✕</button>
          </div>
        </div>

        {/* Fixed search bar — pinned below the header, never scrolls or moves.
            Results float below it as an absolute dropdown over the body (same
            pattern as the gym ExerciseAutocomplete), so typing shifts nothing. */}
        {view === 'build' && (
          <div className="relative px-5 pt-3">
            <div className="flex gap-2">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && hits[0]) pickHit(hits[0])
                  if (e.key === 'Escape') setQuery('')
                }}
                placeholder={rows.length === 0 ? 'Search ingredients, drinks, meals…' : 'Add another ingredient…'}
                className="min-w-0 flex-1 rounded-xl border border-white/[0.12] bg-black/30 px-3 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
              />
              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={() => setView('scan')}
                disabled={scanBusy}
                className="flex w-12 shrink-0 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] text-zinc-300 disabled:opacity-50"
                aria-label="Scan barcode"
              >
                {scanBusy ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
                    className="h-4 w-4 rounded-full border-2 border-zinc-500 border-t-white"
                  />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8" />
                  </svg>
                )}
              </motion.button>
            </div>

            <AnimatePresence>
              {query.trim() !== '' && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute left-5 right-5 top-full z-30 mt-2"
                  style={{ transformOrigin: 'top' }}
                >
                  <div
                    className="max-h-[45vh] space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-white/10 p-1.5"
                    style={{ background: '#191919', boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.4)' }}
                  >
                    {hits.length > 0 ? (
                      <SearchResults hits={hits} onPick={pickHit} onEditCustom={startEditIngredient} />
                    ) : (
                      <p className="py-3 text-center text-xs text-zinc-600">Nothing in the library for “{query}”</p>
                    )}
                    <button
                      onClick={() => {
                        setCreatePrefill({ name: query.trim() || undefined })
                        setQuery('')
                        setView('create')
                      }}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-xs text-zinc-300 active:bg-white/[0.06]"
                    >
                      ⌨ Type exact macros for “{query.trim().slice(0, 24)}”
                    </button>
                    <button
                      onClick={() => onDescribeWithAI(query.trim())}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-xs text-zinc-400 active:bg-white/[0.04]"
                    >
                      ✨ Estimate it with AI instead
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-4 pt-3">
          {error && <p className="text-xs text-red-400">{error}</p>}

          {view === 'create' ? (
            <CreateIngredientForm
              editing={editingIngredient}
              prefill={createPrefill}
              onCancel={() => {
                setView('build')
                setEditingIngredient(null)
              }}
              onCreated={ing => {
                setView('build')
                setEditingIngredient(null)
                addIngredient(fromUserIngredient(ing, defaultGrams(ing)))
              }}
              onSaved={() => {
                setView('build')
                setEditingIngredient(null)
              }}
            />
          ) : (
            <>
              {/* Editing an existing recipe — the tray is the recipe itself */}
              {editingMealId && (
                <div className="flex items-center justify-between rounded-xl border border-violet-300/30 bg-violet-300/[0.06] px-3 py-2">
                  <span className="text-[11px] text-violet-200">Editing recipe · add or remove ingredients</span>
                  <button onClick={resetBuilder} className="text-[11px] text-zinc-400 active:text-white">
                    Cancel
                  </button>
                </div>
              )}

              {/* Portion scaling for a loaded saved meal (not while editing it) */}
              {loadedMeal && !editingMealId && rows.length > 0 && (
                <motion.div layout className="flex items-center gap-1.5" transition={SPRING}>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">Portion</span>
                  {SCALES.map(s => (
                    <button
                      key={s}
                      onClick={() => applyScale(s)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] transition-colors ${
                        scale === s
                          ? 'border-emerald-300/60 bg-emerald-300/10 text-white'
                          : 'border-white/[0.10] bg-white/[0.03] text-zinc-400'
                      }`}
                    >
                      {s === 0.5 ? '½×' : `${s}×`}
                    </button>
                  ))}
                </motion.div>
              )}

              {/* Tray — the meal builds up here, below the fixed search */}
              {rows.length > 0 && (
                <motion.div layout className="space-y-1.5" transition={SPRING}>
                  <AnimatePresence initial={false}>
                    {rows.map(row => (
                      <TrayRowView
                        key={row.key}
                        row={row}
                        editing={editingKey === row.key}
                        onEdit={open => setEditingKey(open ? row.key : null)}
                        onChangeGrams={g => changeGrams(row.key, g)}
                        onRemove={() => removeRow(row.key)}
                      />
                    ))}
                  </AnimatePresence>
                </motion.div>
              )}

              {/* Empty-state discovery */}
              {showEmptyState && (
                <div className="space-y-4">
                  {(savedMeals ?? []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase tracking-wider text-zinc-600">Your meals</p>
                      <div className="-mx-1 overflow-x-auto">
                        <div className="flex w-max gap-2 px-1 pb-1">
                          {(savedMeals ?? []).map(meal => (
                            <SavedMealCard
                              key={meal.id}
                              meal={meal}
                              logging={quickLogId === meal.id}
                              onLoad={() => loadSavedMeal(meal)}
                              onEdit={() => startEditMeal(meal)}
                              onQuickLog={() => quickLog(meal)}
                              onDelete={() => deleteSavedMeal.mutate({ id: meal.id })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">Browse</p>
                    <CategoryBrowser
                      onPick={ing =>
                        addIngredient(
                          fromLibrary(ing, defaultGrams({ unit_grams: ing.units?.[0]?.grams, liquid: ing.liquid }))
                        )
                      }
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — name + save-as + log */}
        {view === 'build' && rows.length > 0 && (
          <motion.div
            layout
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={SPRING}
            className="space-y-2.5 rounded-b-3xl border-t border-white/[0.07] bg-[#111113] px-5 py-3"
          >
            {/* Totals live in the footer now — the top of the sheet stays still
                while you add ingredients. */}
            <TotalsBar rows={rows} />
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={mealName}
                onChange={e => setMealName(e.target.value)}
                placeholder={suggestedName || 'Name this meal'}
                className="min-w-0 flex-1 rounded-xl border border-white/[0.10] bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
              />
              {!loadedMeal && (
                <button
                  onClick={() => setSaveAs(!saveAs)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors ${
                    saveAs
                      ? 'border-violet-300/50 bg-violet-300/10 text-violet-200'
                      : 'border-white/[0.10] bg-white/[0.03] text-zinc-500'
                  }`}
                >
                  <motion.span animate={{ scale: saveAs ? 1 : 0.85, opacity: saveAs ? 1 : 0.5 }} transition={SPRING}>
                    ★
                  </motion.span>
                  Save meal
                </button>
              )}
            </div>
            {editingMealId ? (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={saveMealEdits}
                disabled={updateSavedMeal.isPending}
                className="h-12 w-full rounded-xl text-sm font-semibold text-black disabled:opacity-40"
                style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
              >
                {updateSavedMeal.isPending ? 'Saving…' : 'Save recipe changes'}
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={log}
                disabled={logMeal.isPending}
                className="h-12 w-full rounded-xl text-sm font-semibold text-black disabled:opacity-40"
                style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
              >
                {logMeal.isPending ? 'Logging…' : `Log ${totals.cal.toLocaleString()} cal`}
              </motion.button>
            )}
          </motion.div>
        )}
      </motion.div>
    </div>
  )
}
