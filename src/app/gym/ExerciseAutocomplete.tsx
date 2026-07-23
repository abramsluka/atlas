'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { ExerciseLibraryEntry } from '@/features/gym/types'
import { SPRING_SNAPPY } from './motion'

interface Props {
  value: string
  onChange: (name: string) => void   // free typing — caller clears libraryId
  onPick: (entry: ExerciseLibraryEntry) => void
  onInfo: (id: string) => void
  entries: ExerciseLibraryEntry[]    // slim index, pre-sorted by popularity desc
  linked: boolean                    // current value is a library pick
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

function score(entry: ExerciseLibraryEntry, q: string): number {
  const n = norm(entry.name)
  if (n.startsWith(q)) return 3
  const aliases = entry.aliases.map(norm)
  if (aliases.some(a => a.startsWith(q))) return 2
  if (n.includes(q) || aliases.some(a => a.includes(q))) return 1
  return 0
}

function Highlight({ text, q }: { text: string; q: string }) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase().trim())
  if (idx < 0 || !q.trim()) return <span className="text-white/60">{text}</span>
  const end = idx + q.trim().length
  return (
    <span className="text-white/60">
      {text.slice(0, idx)}
      <span className="text-white">{text.slice(idx, end)}</span>
      {text.slice(end)}
    </span>
  )
}

export default function ExerciseAutocomplete({ value, onChange, onPick, onInfo, entries, linked }: Props) {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()

  const q = norm(value)
  const results = useMemo(() => {
    if (q.length < 2) return []
    // entries are pre-sorted by popularity, so a stable sort by score keeps rank ties popular-first
    return entries
      .map(e => ({ e, s: score(e, q) }))
      .filter(r => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(r => r.e)
  }, [entries, q])

  const showList = open && q.length >= 2 && !linked

  return (
    <div className="relative">
      <div className="relative">
        <input
          autoFocus
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && showList && results.length) { e.preventDefault(); onPick(results[0]); setOpen(false) }
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="e.g. Bench Press"
          className="w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none"
        />
        <AnimatePresence>
          {linked && (
            <motion.span
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={SPRING_SNAPPY}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold tracking-widest uppercase px-2 py-1 rounded-full"
              style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}
            >
              ⚡ library
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Absolute overlay so the dropdown floats over the fields below instead of
          pushing them down (the bottom-anchored modal would jump up otherwise). */}
      <AnimatePresence>
        {showList && (
          <motion.div
            initial={reduced ? false : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full mt-2 z-30"
            style={{ transformOrigin: 'top' }}
          >
            <div
              className="rounded-xl border border-white/10 max-h-56 overflow-y-auto overscroll-contain divide-y divide-white/[0.05]"
              style={{ background: '#191919', boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.4)' }}
            >
              <AnimatePresence initial={false} mode="popLayout">
                {results.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    layout={reduced ? false : true}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? undefined : { opacity: 0, scale: 0.98 }}
                    transition={{ ...SPRING_SNAPPY, delay: i * 0.02 }}
                    className="relative flex items-center gap-2 px-3.5 py-2.5 active:bg-white/[0.06]"
                    onClick={() => { onPick(entry); setOpen(false) }}
                  >
                    {i === 0 && (
                      <motion.span
                        layoutId="ac-top-accent"
                        transition={SPRING_SNAPPY}
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full"
                        style={{ background: '#4ade80', boxShadow: '0 0 8px rgba(74,222,128,0.5)' }}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate"><Highlight text={entry.short_name || entry.name} q={value} /></p>
                      <p className="text-[10px] text-white/35 capitalize truncate">
                        {entry.primary_muscles[0] ?? entry.default_goal}
                        {entry.bodyweight && <span className="text-white/25"> · bodyweight</span>}
                      </p>
                    </div>
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
              </AnimatePresence>
              <div
                className="px-3.5 py-2.5 active:bg-white/[0.06]"
                onClick={() => setOpen(false)}
              >
                <p className="text-xs text-white/40">
                  Use &ldquo;<span className="text-white/70">{value.trim()}</span>&rdquo; as custom exercise
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
