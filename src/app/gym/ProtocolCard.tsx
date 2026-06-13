'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { GYM_PRESETS } from '@/data/gymPresets'

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const PRESET = GYM_PRESETS[0]

const GOAL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Hypertrophy: { text: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  Endurance:   { text: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  Strength:    { text: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)' },
}

interface Props {
  today: string // YYYY-MM-DD — used as daily reset key
}

type SetCounts = Record<string, number>

function storageKey(date: string) {
  return `neck_jaw_sets_${date}`
}

function loadCounts(today: string): SetCounts {
  try {
    const raw = localStorage.getItem(storageKey(today))
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveCounts(today: string, counts: SetCounts) {
  try {
    localStorage.setItem(storageKey(today), JSON.stringify(counts))
  } catch {}
}

export default function ProtocolCard({ today }: Props) {
  const [setCounts, setSetCounts] = useState<SetCounts>({})
  const [expandedEx, setExpandedEx] = useState<string | null>(null)
  const [flashEx, setFlashEx] = useState<string | null>(null)

  // Load today's counts from localStorage on mount
  useEffect(() => {
    setSetCounts(loadCounts(today))
  }, [today])

  function logSet(name: string) {
    setSetCounts(prev => {
      const next = { ...prev, [name]: (prev[name] ?? 0) + 1 }
      saveCounts(today, next)
      return next
    })
    // Flash the chip green briefly
    setFlashEx(name)
    setTimeout(() => setFlashEx(null), 600)
  }

  const doneCount = PRESET.exercises.filter(ex => (setCounts[ex.name] ?? 0) > 0).length
  const totalCount = PRESET.exercises.length

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
      style={{
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderLeft: '2px solid rgba(251,191,36,0.35)',
        borderRadius: 18,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <motion.span
                animate={{ opacity: [0.45, 0.85, 0.45] }}
                transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                className="text-[10px] font-bold tracking-[0.22em] uppercase"
                style={{ color: 'rgba(251,191,36,0.75)' }}
              >
                ✦ DAILY PROTOCOL
              </motion.span>
            </div>
            <h3 className="text-[17px] font-bold text-white leading-snug">{PRESET.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{PRESET.subtitle}</p>
          </div>

          {/* Progress pill */}
          <div
            className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5"
            style={{
              background: doneCount === totalCount ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)',
              border: `1px solid ${doneCount === totalCount ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.1)'}`,
            }}
          >
            <span
              className="text-xs font-bold tabular-nums"
              style={{ color: doneCount === totalCount ? '#4ade80' : 'rgba(255,255,255,0.5)' }}
            >
              {doneCount}/{totalCount}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-px rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, rgba(251,191,36,0.6) 0%, rgba(74,222,128,0.7) 100%)' }}
            initial={{ width: 0 }}
            animate={{ width: `${(doneCount / totalCount) * 100}%` }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
          />
        </div>
      </div>

      {/* Exercise list */}
      <div className="px-4 pb-5 space-y-1.5 mt-1">
        {PRESET.exercises.map((ex, i) => {
          const sets = setCounts[ex.name] ?? 0
          const done = sets > 0
          const isExpanded = expandedEx === ex.name
          const isFlashing = flashEx === ex.name
          const goalStyle = GOAL_COLORS[ex.goal] ?? GOAL_COLORS.Hypertrophy

          return (
            <motion.div
              key={ex.name}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: EASE_OUT, delay: 0.06 + i * 0.04 }}
            >
              {/* Chip row */}
              <motion.button
                layout="position"
                onClick={() => setExpandedEx(prev => prev === ex.name ? null : ex.name)}
                whileTap={{ scale: 0.975 }}
                className="w-full text-left transition-all duration-200"
                animate={isFlashing ? {
                  boxShadow: ['0 0 0px rgba(74,222,128,0)', '0 0 18px rgba(74,222,128,0.25)', '0 0 0px rgba(74,222,128,0)'],
                } : {}}
                style={{
                  background: isFlashing
                    ? 'rgba(74,222,128,0.12)'
                    : done
                      ? 'rgba(74,222,128,0.06)'
                      : isExpanded
                        ? 'rgba(251,191,36,0.05)'
                        : 'rgba(255,255,255,0.03)',
                  border: done
                    ? '1px solid rgba(74,222,128,0.2)'
                    : isExpanded
                      ? '1px solid rgba(251,191,36,0.22)'
                      : '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 12,
                  padding: '11px 14px',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Check / dot */}
                  <AnimatePresence mode="wait">
                    {done ? (
                      <motion.div
                        key="check"
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)' }}
                      >
                        <span className="text-[10px]" style={{ color: '#4ade80' }}>✓</span>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="dot"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          background: isExpanded ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.05)',
                          border: isExpanded ? '1px solid rgba(251,191,36,0.25)' : '1px solid rgba(255,255,255,0.1)',
                        }}
                      >
                        <span className="text-[9px]" style={{ color: isExpanded ? 'rgba(251,191,36,0.7)' : 'rgba(255,255,255,0.2)' }}>○</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Name */}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: done ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.7)' }}
                    >
                      {ex.name}
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-[9px] font-bold tracking-[0.14em] uppercase px-1.5 py-0.5 rounded-full"
                        style={{ background: goalStyle.bg, color: goalStyle.text, border: `1px solid ${goalStyle.border}` }}
                      >
                        {ex.goal}
                      </span>
                      <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>
                        {ex.startingPoint}
                      </span>
                    </div>
                  </div>

                  {/* Set count + chevron */}
                  <div className="flex items-center gap-2 shrink-0">
                    {sets > 0 && (
                      <motion.span
                        key={sets}
                        initial={{ scale: 1.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }}
                        className="text-xs font-bold tabular-nums"
                        style={{ color: '#4ade80' }}
                      >
                        {sets}×
                      </motion.span>
                    )}
                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[10px]"
                      style={{ color: 'rgba(255,255,255,0.18)' }}
                    >▾</motion.span>
                  </div>
                </div>
              </motion.button>

              {/* Expanded drawer */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.26, ease: EASE_OUT }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      className="mt-1 rounded-xl px-4 py-4 space-y-3"
                      style={{
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}
                    >
                      {/* Description */}
                      <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {ex.description}
                      </p>

                      {/* Coaching cue */}
                      <div
                        className="rounded-lg px-3 py-2.5"
                        style={{ background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.12)' }}
                      >
                        <p className="text-[10px] font-bold tracking-[0.15em] uppercase mb-1" style={{ color: 'rgba(251,191,36,0.5)' }}>Cue</p>
                        <p className="text-xs italic leading-relaxed" style={{ color: 'rgba(251,191,36,0.7)' }}>"{ex.cue}"</p>
                      </div>

                      {/* Progression note */}
                      <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {ex.progression}
                      </p>

                      {/* Log a set button */}
                      <motion.button
                        onClick={() => logSet(ex.name)}
                        whileTap={{ scale: 0.96 }}
                        className="w-full rounded-xl py-3 text-sm font-bold active:opacity-80 mt-1"
                        style={sets > 0 ? {
                          background: 'rgba(74,222,128,0.1)',
                          border: '1px solid rgba(74,222,128,0.25)',
                          color: '#4ade80',
                        } : {
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: 'rgba(255,255,255,0.8)',
                        }}
                      >
                        {sets === 0 ? 'Log a set' : `Log another set  ·  ${sets} done today`}
                      </motion.button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* Footer hint */}
      {doneCount === 0 && (
        <div className="px-5 pb-4 -mt-1">
          <p className="text-center text-[10px]" style={{ color: 'rgba(255,255,255,0.18)' }}>
            Tap an exercise to expand · resets every day
          </p>
        </div>
      )}
      {doneCount === totalCount && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="px-5 pb-5 -mt-1"
        >
          <div
            className="rounded-xl px-4 py-3 text-center"
            style={{ background: 'rgba(74,222,128,0.07)', border: '1px solid rgba(74,222,128,0.2)' }}
          >
            <p className="text-sm font-semibold" style={{ color: '#4ade80' }}>All done for today ✓</p>
            <p className="text-[10px] mt-0.5" style={{ color: 'rgba(74,222,128,0.5)' }}>Resets tomorrow</p>
          </div>
        </motion.div>
      )}
    </motion.section>
  )
}
