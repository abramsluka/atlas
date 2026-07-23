'use client'

// Today-only exercise swap — for training away from the home gym.
// Picks a substitute for the CURRENT DAY only: sets logged while swapped carry
// performed_exercise metadata and never touch the original lift's progression.
// Suggestions share a primary muscle and prefer DIFFERENT equipment.
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { GymExercise, ExerciseLibraryEntry } from '@/features/gym/types'
import { SPRING_SHEET, SPRING_SNAPPY } from './motion'

export interface SwapChoice {
  name: string
  library_id: string | null
}

interface Props {
  open: boolean
  exercise: GymExercise | null
  entries: ExerciseLibraryEntry[]   // slim index, pre-sorted by popularity desc
  onPick: (choice: SwapChoice) => void
  onInfo: (libraryId: string) => void
  onClose: () => void
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function searchScore(entry: ExerciseLibraryEntry, q: string): number {
  const n = norm(entry.name)
  if (n.startsWith(q)) return 3
  const aliases = entry.aliases.map(norm)
  if (aliases.some(a => a.startsWith(q))) return 2
  if (n.includes(q) || aliases.some(a => a.includes(q))) return 1
  return 0
}

function Body({ exercise, entries, onPick, onInfo, onClose }: Omit<Props, 'open'> & { exercise: GymExercise }) {
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const q = norm(query)

  const current = useMemo(
    () => entries.find(e => e.id === exercise.library_id) ?? null,
    [entries, exercise.library_id],
  )

  const rows = useMemo(() => {
    if (q.length >= 2) {
      // search mode — same scoring as the add-exercise autocomplete
      return entries
        .map(e => ({ e, s: searchScore(e, q) }))
        .filter(r => r.s > 0 && r.e.id !== exercise.library_id)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map(r => r.e)
    }
    // suggestion mode — share a primary muscle, prefer different equipment,
    // popularity tiebreak (entries are pre-sorted by popularity)
    const muscles = new Set(current?.primary_muscles ?? [])
    const pool = muscles.size
      ? entries.filter(e => e.id !== exercise.library_id && e.primary_muscles.some(m => muscles.has(m)))
      : entries.filter(e => e.id !== exercise.library_id)
    const diffEquip = current?.equipment
      ? pool.filter(e => e.equipment !== current.equipment)
      : pool
    const sameEquip = pool.filter(e => !diffEquip.includes(e))
    return [...diffEquip, ...sameEquip].slice(0, 8)
  }, [entries, q, current, exercise.library_id])

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_SHEET}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose()
        }}
        className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-[#111] border-t border-white/10 max-h-[80vh] flex flex-col"
      >
        <div className="shrink-0 pt-3 pb-1 flex justify-center" style={{ touchAction: 'none' }}>
          <div className="w-9 h-1 rounded-full bg-white/15" />
        </div>

        <div className="px-5 pb-2">
          <div className="flex items-start justify-between gap-3 mb-1">
            <h2 className="text-lg font-bold text-white leading-tight">
              Swap {exercise.name}
            </h2>
            <button onClick={onClose} className="text-white/40 text-2xl leading-none shrink-0">×</button>
          </div>
          <p className="text-[11px] text-white/35 mb-3">
            Today only — tomorrow this slot is back to {exercise.name}. Logged sets won&apos;t touch its progression.
          </p>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search a substitute…"
            className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
          />
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pb-10">
          {q.length < 2 && rows.length > 0 && (
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/25 mt-2 mb-1">
              Same muscle · different equipment first
            </p>
          )}
          <div className="divide-y divide-white/[0.05]">
            {rows.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...SPRING_SNAPPY, delay: reduced ? 0 : i * 0.025 }}
                className="flex items-center gap-2.5 py-3 active:bg-white/[0.04]"
                onClick={() => onPick({ name: entry.short_name || entry.name, library_id: entry.id })}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white/85 truncate">{entry.short_name || entry.name}</p>
                  <p className="text-[10px] text-white/35 capitalize truncate">
                    {entry.primary_muscles[0] ?? entry.default_goal}
                  </p>
                </div>
                {entry.equipment && (
                  <span className="shrink-0 text-[9px] uppercase tracking-wider px-2 py-1 rounded-md bg-white/[0.04] border border-white/10 text-white/40 capitalize">
                    {entry.equipment}
                  </span>
                )}
                <button
                  onClick={e => { e.stopPropagation(); onInfo(entry.id) }}
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs text-white/40 active:text-white"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                  aria-label={`About ${entry.name}`}
                >
                  i
                </button>
              </motion.div>
            ))}
          </div>

          {query.trim().length > 0 && (
            <div
              className="mt-2 py-3 px-1 active:bg-white/[0.04] rounded-lg"
              onClick={() => onPick({ name: query.trim(), library_id: null })}
            >
              <p className="text-xs text-white/40 border border-dashed border-white/15 rounded-xl px-4 py-3">
                Use &ldquo;<span className="text-white/70">{query.trim()}</span>&rdquo; as today&apos;s swap
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
}

export default function SwapSheet({ open, exercise, entries, onPick, onInfo, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && exercise && (
        <Body
          key={exercise.id}
          exercise={exercise}
          entries={entries}
          onPick={onPick}
          onInfo={onInfo}
          onClose={onClose}
        />
      )}
    </AnimatePresence>,
    document.body
  )
}
