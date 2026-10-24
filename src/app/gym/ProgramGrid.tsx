'use client'

// Program grid — bulk day/gym assignment. Every exercise is a row, every split
// day (or gym) a column; tap a cell to toggle. Edits stay local until Save,
// which writes all changed rows in one call.
//
// Gym semantics match the rest of the tab: an empty gym_ids means "every gym".
// Those rows show every cell lit (softer) with an ALL tag; tapping one gym off
// converts the row to an explicit list, and turning the last one off flips it
// back to ALL rather than leaving a confusing "no gyms".
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import type { GymConfig, GymExercise } from '@/features/gym/types'
import { useBulkAssignExercises, type ExerciseAssignment } from '@/features/gym/mutations'
import { SPRING_SHEET } from './motion'

type Mode = 'days' | 'gyms'
type Draft = Record<string, { gym_ids: string[]; day_ids: string[] }>

interface Props {
  open: boolean
  exercises: GymExercise[]
  config: GymConfig
  onClose: () => void
}

// Order-insensitive, so toggling a cell off and back on isn't a "change"
const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

function Body({ exercises, config, onClose }: Omit<Props, 'open'>) {
  const bulk = useBulkAssignExercises()
  const [mode, setMode] = useState<Mode>('days')
  const [query, setQuery] = useState('')
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(exercises.map(e => [e.id, { gym_ids: e.gym_ids ?? [], day_ids: e.day_ids ?? [] }]))
  )

  const dayIds = useMemo(() => new Set(config.days.map(d => d.id)), [config.days])
  const gymIds = useMemo(() => new Set(config.gyms.map(g => g.id)), [config.gyms])
  const validDays = (ids: string[]) => ids.filter(id => dayIds.has(id))
  const validGyms = (ids: string[]) => ids.filter(id => gymIds.has(id))

  const sorted = useMemo(() => [...exercises].sort((a, b) => a.order_index - b.order_index), [exercises])
  const unassignedCount = sorted.filter(e => validDays(draft[e.id]?.day_ids ?? []).length === 0).length

  const rows = sorted.filter(e => {
    if (query.trim() && !e.name.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (unassignedOnly && validDays(draft[e.id]?.day_ids ?? []).length > 0) return false
    return true
  })

  const changes: ExerciseAssignment[] = sorted
    .filter(e => {
      const d = draft[e.id]
      return d && (!sameIds(d.day_ids, e.day_ids ?? []) || !sameIds(d.gym_ids, e.gym_ids ?? []))
    })
    .map(e => ({ id: e.id, ...draft[e.id] }))

  const columns = mode === 'days' ? config.days : config.gyms

  function toggle(exId: string, colId: string) {
    setDraft(prev => {
      const cur = prev[exId]
      if (mode === 'days') {
        const day_ids = cur.day_ids.includes(colId)
          ? cur.day_ids.filter(id => id !== colId)
          : [...cur.day_ids, colId]
        return { ...prev, [exId]: { ...cur, day_ids } }
      }
      const explicit = validGyms(cur.gym_ids)
      let gym_ids: string[]
      if (explicit.length === 0) gym_ids = config.gyms.map(g => g.id).filter(id => id !== colId)
      else if (explicit.includes(colId)) gym_ids = explicit.filter(id => id !== colId)
      else gym_ids = [...explicit, colId]
      return { ...prev, [exId]: { ...cur, gym_ids } }
    })
  }

  function colCount(colId: string) {
    return sorted.filter(e => {
      const d = draft[e.id]
      if (!d) return false
      if (mode === 'days') return d.day_ids.includes(colId)
      const g = validGyms(d.gym_ids)
      return g.length === 0 || g.includes(colId)
    }).length
  }

  function subtitle(exId: string) {
    const d = draft[exId]
    if (mode === 'days') {
      const g = validGyms(d.gym_ids)
      return g.length === 0 ? 'All gyms' : g.map(id => config.gyms.find(x => x.id === id)!.name).join(' · ')
    }
    const days = validDays(d.day_ids)
    return days.length === 0 ? 'No day' : days.map(id => config.days.find(x => x.id === id)!.name).join(' · ')
  }

  function close() {
    if (changes.length && !window.confirm(`Discard ${changes.length} unsaved change${changes.length === 1 ? '' : 's'}?`)) return
    onClose()
  }

  function save() {
    if (!changes.length) return onClose()
    bulk.mutate(changes, { onSuccess: onClose })
  }

  const accent = mode === 'days' ? '#4ade80' : '#7DD3FC'
  const gridCols = `minmax(120px,1fr) repeat(${columns.length}, 48px)`

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        onClick={close}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_SHEET}
        className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-[#111] border-t border-white/10 h-[92vh] flex flex-col"
      >
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-lg font-bold text-white leading-tight">Program</h2>
            <button onClick={close} className="text-white/40 text-2xl leading-none shrink-0">×</button>
          </div>
          <p className="text-[11px] text-white/35 mb-3">Tap a cell to put an exercise on that {mode === 'days' ? 'day' : 'gym'}.</p>

          <div className="flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1 mb-3">
            {(['days', 'gyms'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold capitalize transition-colors ${mode === m ? 'bg-white text-black' : 'text-white/50'}`}
              >
                {m}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises…"
              className="flex-1 min-w-0 rounded-xl bg-white/8 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none"
            />
            {unassignedCount > 0 && (
              <button
                onClick={() => setUnassignedOnly(v => !v)}
                className={`shrink-0 rounded-xl px-3 text-xs font-semibold border ${unassignedOnly ? 'bg-amber-400/15 border-amber-400/40 text-amber-300' : 'border-white/10 text-white/45'}`}
              >
                No day · {unassignedCount}
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-5">
          {/* min-w keeps cells tappable when there are more columns than fit */}
          <div style={{ minWidth: 120 + columns.length * 48 }}>
            <div
              className="sticky top-0 z-10 grid items-end bg-[#111] pb-2 pt-1 border-b border-white/8"
              style={{ gridTemplateColumns: gridCols }}
            >
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/25">
                {rows.length} exercise{rows.length === 1 ? '' : 's'}
              </span>
              {columns.map(c => (
                <div key={c.id} className="text-center px-0.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-white/70 leading-tight line-clamp-2 break-words">{c.name}</p>
                  <p className="text-[9px] font-mono text-white/25 mt-0.5">{colCount(c.id)}</p>
                </div>
              ))}
            </div>

            <div className="divide-y divide-white/[0.05] pb-4">
              {rows.map(ex => {
                const d = draft[ex.id]
                const allGyms = mode === 'gyms' && validGyms(d.gym_ids).length === 0
                return (
                  <div key={ex.id} className="grid items-center py-2" style={{ gridTemplateColumns: gridCols }}>
                    <div className="min-w-0 pr-2">
                      <p className="text-sm text-white/85 truncate">
                        {ex.name}
                        {allGyms && <span className="ml-1.5 text-[9px] font-bold tracking-wider text-sky-300/70 align-middle">ALL</span>}
                      </p>
                      <p className="text-[10px] text-white/30 truncate">{subtitle(ex.id)}</p>
                    </div>
                    {columns.map(c => {
                      const on = mode === 'days' ? d.day_ids.includes(c.id) : allGyms || d.gym_ids.includes(c.id)
                      return (
                        <button
                          key={c.id}
                          onClick={() => toggle(ex.id, c.id)}
                          aria-pressed={on}
                          aria-label={`${ex.name} on ${c.name}`}
                          className="h-11 flex items-center justify-center active:scale-90 transition-transform"
                        >
                          <span
                            className="block w-6 h-6 rounded-full border transition-colors"
                            style={on
                              ? { background: allGyms ? `${accent}55` : accent, borderColor: accent }
                              : { background: 'transparent', borderColor: 'rgba(255,255,255,0.15)' }}
                          />
                        </button>
                      )
                    })}
                  </div>
                )
              })}
              {rows.length === 0 && (
                <p className="text-sm text-white/30 text-center py-10">No exercises match.</p>
              )}
            </div>
          </div>
        </div>

        <div className="shrink-0 px-5 pt-3 pb-8 border-t border-white/8">
          {bulk.isError && <p className="text-xs text-red-400 mb-2 text-center">Couldn&apos;t save. Try again.</p>}
          <button
            onClick={save}
            disabled={bulk.isPending}
            className="w-full rounded-xl py-3 text-sm font-semibold text-black active:scale-[0.98] transition-transform disabled:opacity-60"
            style={{ background: changes.length ? 'linear-gradient(180deg,#6ee7b7 0%,#34d399 100%)' : 'rgba(255,255,255,0.85)' }}
          >
            {bulk.isPending ? 'Saving…' : changes.length ? `Save ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'Done'}
          </button>
        </div>
      </motion.div>
    </>
  )
}

export default function ProgramGrid({ open, exercises, config, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && <Body exercises={exercises} config={config} onClose={onClose} />}
    </AnimatePresence>,
    document.body
  )
}
