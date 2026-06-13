'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { useGymExercises } from '@/features/gym/queries'
import { GYM_PRESETS } from '@/data/gymPresets'
import type { GymConfig } from '@/features/gym/types'

const EASE_OUT = [0.16, 1, 0.3, 1] as const

const PRESET = GYM_PRESETS[0] // neck-jaw

type CardState = 'idle' | 'confirm' | 'loading' | 'done'

const GOAL_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Hypertrophy: { text: '#a78bfa', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.2)' },
  Endurance:   { text: '#38bdf8', bg: 'rgba(56,189,248,0.08)',  border: 'rgba(56,189,248,0.2)' },
  Strength:    { text: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)' },
}

interface Props {
  config: GymConfig
  onViewInGym: () => void
}

export default function ProtocolCard({ config, onViewInGym }: Props) {
  const qc = useQueryClient()
  const { data: exercises = [] } = useGymExercises()

  const [cardState, setCardState] = useState<CardState>('idle')
  const [expandedEx, setExpandedEx] = useState<string | null>(null)
  const [checkedChips, setCheckedChips] = useState<Set<string>>(new Set())
  const [addedNames, setAddedNames] = useState<Set<string>>(new Set())
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Compute which preset exercises are already in gym
  const alreadyAdded = useCallback(
    (name: string) => exercises.some(e => e.name.toLowerCase() === name.toLowerCase()),
    [exercises]
  )

  const allAlreadyAdded = PRESET.exercises.every(ex => alreadyAdded(ex.name))
  const newCount = PRESET.exercises.filter(ex => !alreadyAdded(ex.name)).length

  // Auto-switch to done if all exercises already exist
  useEffect(() => {
    if (allAlreadyAdded && cardState === 'idle') setCardState('done')
  }, [allAlreadyAdded, cardState])

  async function handleApply() {
    if (cardState === 'idle') {
      setCardState('confirm')
      return
    }
    if (cardState !== 'confirm') return

    setCardState('loading')
    setErrorMsg(null)

    try {
      const gymId = config.gyms[0]?.id ?? 'g_default'
      const res = await fetch(`/api/gym/presets/${PRESET.id}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gymId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')

      // Stagger chip check animations
      const names = PRESET.exercises.map(ex => ex.name)
      for (let i = 0; i < names.length; i++) {
        await new Promise<void>(r => setTimeout(r, i * 140))
        setCheckedChips(prev => new Set([...prev, names[i]]))
      }

      // Track which were newly added
      const addedSet = new Set<string>((json.added ?? []).map((e: { name: string }) => e.name.toLowerCase()))
      setAddedNames(addedSet)

      await new Promise<void>(r => setTimeout(r, 200))

      qc.invalidateQueries({ queryKey: ['gym-exercises'] })
      setCardState('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setCardState('confirm')
    }
  }

  function toggleChip(name: string) {
    setExpandedEx(prev => prev === name ? null : name)
  }

  const isDone = cardState === 'done' || allAlreadyAdded
  const isLoading = cardState === 'loading'

  const ctaLabel = (() => {
    if (isLoading) return 'Adding…'
    if (cardState === 'confirm') return `Add ${newCount} exercise${newCount !== 1 ? 's' : ''} →`
    return `Add all ${newCount} exercises`
  })()

  if (isDone && !isLoading) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        style={{
          background: 'rgba(255,255,255,0.025)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderLeft: '2px solid rgba(251,191,36,0.35)',
          borderRadius: 18,
          padding: '20px',
        }}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold tracking-[0.22em] uppercase" style={{ color: 'rgba(251,191,36,0.7)' }}>
                ✦ STARTER PROTOCOL
              </span>
              <span className="text-[10px] font-bold tracking-widest rounded-full px-2 py-0.5"
                style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }}>
                IN YOUR GYM
              </span>
            </div>
            <h3 className="text-base font-bold text-white">{PRESET.title}</h3>
            <p className="text-xs text-white/35 mt-0.5">{PRESET.subtitle}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-4">
          {PRESET.exercises.map((ex, i) => (
            <motion.div
              key={ex.name}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3, ease: EASE_OUT, delay: i * 0.04 }}
              style={{
                background: 'rgba(74,222,128,0.06)',
                border: '1px solid rgba(74,222,128,0.18)',
                borderRadius: 12,
                padding: '10px 12px',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: '#4ade80' }}>✓</span>
                <span className="text-xs font-medium text-white/80 leading-snug">{ex.name}</span>
              </div>
            </motion.div>
          ))}
        </div>

        <button
          onClick={onViewInGym}
          className="w-full text-xs font-semibold active:opacity-60 text-center py-2"
          style={{ color: 'rgba(251,191,36,0.65)' }}
        >
          View in your gym ↑
        </button>
      </motion.section>
    )
  }

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
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <motion.span
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                className="text-[10px] font-bold tracking-[0.22em] uppercase"
                style={{ color: 'rgba(251,191,36,0.75)' }}
              >
                ✦ STARTER PROTOCOL
              </motion.span>
            </div>
            <h3 className="text-[17px] font-bold text-white leading-snug">{PRESET.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>{PRESET.subtitle}</p>
          </div>
        </div>

        {/* Horizontal rule with amber glow */}
        <div className="h-px mb-4" style={{ background: 'linear-gradient(to right, rgba(251,191,36,0.2), transparent)' }} />

        {/* Exercise chips */}
        <div className="grid grid-cols-2 gap-2">
          {PRESET.exercises.map((ex, i) => {
            const isExpanded = expandedEx === ex.name
            const isChecked = checkedChips.has(ex.name) || alreadyAdded(ex.name)
            const goalStyle = GOAL_COLORS[ex.goal] ?? GOAL_COLORS.Hypertrophy
            const isNew = addedNames.has(ex.name.toLowerCase())

            return (
              <motion.div
                key={ex.name}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT, delay: 0.05 + i * 0.05 }}
                style={{
                  gridColumn: isExpanded ? 'span 2' : 'span 1',
                }}
              >
                <motion.button
                  layout="position"
                  onClick={() => !isLoading && toggleChip(ex.name)}
                  whileTap={!isLoading ? { scale: 0.96 } : {}}
                  className="w-full text-left transition-all duration-200"
                  style={{
                    background: isChecked
                      ? 'rgba(74,222,128,0.08)'
                      : isExpanded
                        ? 'rgba(251,191,36,0.06)'
                        : 'rgba(255,255,255,0.04)',
                    border: isChecked
                      ? '1px solid rgba(74,222,128,0.25)'
                      : isExpanded
                        ? '1px solid rgba(251,191,36,0.25)'
                        : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    padding: '10px 12px',
                  }}
                >
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    <AnimatePresence mode="wait">
                      {isChecked ? (
                        <motion.span
                          key="check"
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ duration: 0.25, ease: [0.34, 1.56, 0.64, 1] }}
                          className="text-[11px] shrink-0"
                          style={{ color: '#4ade80' }}
                        >✓</motion.span>
                      ) : (
                        <motion.span
                          key="dot"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: isExpanded ? 'rgba(251,191,36,0.6)' : 'rgba(255,255,255,0.2)' }}
                        />
                      )}
                    </AnimatePresence>

                    <span
                      className="text-xs font-semibold leading-snug flex-1"
                      style={{ color: isChecked ? 'rgba(74,222,128,0.9)' : 'rgba(255,255,255,0.75)' }}
                    >
                      {ex.name}
                    </span>

                    <motion.span
                      animate={{ rotate: isExpanded ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[10px] shrink-0"
                      style={{ color: 'rgba(255,255,255,0.2)' }}
                    >▾</motion.span>
                  </div>

                  {/* Inline goal tag */}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span
                      className="text-[9px] font-bold tracking-[0.15em] uppercase px-1.5 py-0.5 rounded-full"
                      style={{ background: goalStyle.bg, color: goalStyle.text, border: `1px solid ${goalStyle.border}` }}
                    >
                      {ex.goal}
                    </span>
                    <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                      {ex.bodyweight ? 'BW' : 'plate'} · {ex.startingPoint}
                    </span>
                  </div>
                </motion.button>

                {/* Expanded drawer */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.28, ease: EASE_OUT }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div
                        className="mt-1.5 rounded-xl px-4 py-4 space-y-2.5"
                        style={{
                          background: 'rgba(251,191,36,0.04)',
                          border: '1px solid rgba(251,191,36,0.12)',
                        }}
                      >
                        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.65)' }}>
                          {ex.description}
                        </p>
                        <div
                          className="text-[11px] font-medium italic leading-relaxed"
                          style={{ color: 'rgba(251,191,36,0.6)' }}
                        >
                          "{ex.cue}"
                        </div>
                        <div className="h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                        <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.35)' }}>
                          {ex.progression}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* CTA footer */}
      <div
        className="px-5 pb-5 pt-2"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        {errorMsg && (
          <p className="text-xs text-red-400 mb-3 text-center">{errorMsg}</p>
        )}

        <AnimatePresence mode="wait">
          {newCount > 0 && (
            <motion.button
              key="cta"
              layout
              onClick={handleApply}
              disabled={isLoading}
              whileTap={!isLoading ? { scale: 0.97 } : {}}
              className="w-full rounded-xl py-3.5 text-sm font-bold transition-all disabled:opacity-70 active:opacity-80 relative overflow-hidden"
              style={
                cardState === 'confirm'
                  ? {
                      background: 'linear-gradient(135deg, rgba(251,191,36,0.2) 0%, rgba(245,158,11,0.15) 100%)',
                      border: '1px solid rgba(251,191,36,0.4)',
                      color: '#fbbf24',
                      boxShadow: '0 0 20px rgba(251,191,36,0.12)',
                    }
                  : {
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      color: 'rgba(255,255,255,0.75)',
                    }
              }
              animate={cardState === 'confirm' ? {
                boxShadow: ['0 0 0px rgba(251,191,36,0)', '0 0 20px rgba(251,191,36,0.2)', '0 0 0px rgba(251,191,36,0)'],
              } : {}}
              transition={{ duration: 2, repeat: cardState === 'confirm' ? Infinity : 0 }}
            >
              {/* Loading shimmer */}
              {isLoading && (
                <motion.div
                  className="absolute inset-0"
                  style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(251,191,36,0.08) 50%, transparent 100%)' }}
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                />
              )}
              <span className="relative">{ctaLabel}</span>
            </motion.button>
          )}
        </AnimatePresence>

        {cardState === 'idle' && (
          <p className="text-center text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
            Tap an exercise above to see how to perform it
          </p>
        )}

        {cardState === 'confirm' && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-[10px] mt-2"
            style={{ color: 'rgba(251,191,36,0.5)' }}
          >
            Tap again to confirm · exercises will be added unassigned to any training day
          </motion.p>
        )}
      </div>
    </motion.section>
  )
}
