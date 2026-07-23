'use client'

// Full-screen "New best" celebration — fires when a logged set beats the
// all-time record. Locked in the lab: Sparks (~22 shards) + one shockwave
// ring, NO screen flash. Tap anywhere to continue; auto-dismisses as a fallback.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import type { GymExercise } from '@/features/gym/types'
import type { NewBest } from '@/features/gym/history'
import { EASE_OUT } from './motion'

const GOLD = '#f5b23e'
const COLORS = [GOLD, '#ffd98a', '#ffffff', '#ffb347']
const N = 22
const SPREAD = 240

interface Props {
  best: NewBest | null
  units: string
  exercise: GymExercise | null
  onDismiss: () => void
}

const fmtNum = (n: number) => String(+n.toFixed(2)).replace(/\.0+$/, '')

// Deterministic per-index particle params — no Math.random() (SSR-safe, stable).
function particle(i: number) {
  const angle = (i / N) * Math.PI * 2 + ((i * 0.618) % 0.3)
  const dist = SPREAD * (0.55 + ((i * 37) % 100) / 100 * 0.55)
  const size = 3 + ((i * 13) % 5)
  return {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    size,
    height: size * (1 + ((i * 7) % 3)),
    rotate: (angle * 180) / Math.PI,
    color: COLORS[i % COLORS.length],
  }
}

function Burst({ best, units, exercise, onDismiss }: Props & { best: NewBest }) {
  const reduced = useReducedMotion()
  const step = exercise?.step || 2.5
  const bw = exercise?.bodyweight

  useEffect(() => {
    const t = setTimeout(onDismiss, 6000)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', esc)
    return () => { clearTimeout(t); window.removeEventListener('keydown', esc) }
  }, [onDismiss])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26 }}
      className="fixed inset-0 z-[90] flex items-center justify-center cursor-pointer"
      style={{ background: 'radial-gradient(600px 600px at 50% 44%, rgba(245,178,62,0.22), rgba(0,0,0,0.74) 60%, rgba(0,0,0,0.9))' }}
      onClick={onDismiss}
    >
      {/* shockwave ring */}
      {!reduced && (
        <motion.span
          className="absolute rounded-full pointer-events-none"
          style={{ left: '50%', top: '44%', border: '2px solid rgba(245,178,62,0.6)', translateX: '-50%', translateY: '-50%' }}
          initial={{ width: 20, height: 20, opacity: 0.7 }}
          animate={{ width: SPREAD * 1.6, height: SPREAD * 1.6, opacity: 0 }}
          transition={{ duration: 1.4, ease: EASE_OUT }}
        />
      )}

      {/* sparks */}
      {!reduced && Array.from({ length: N }, (_, i) => {
        const p = particle(i)
        return (
          <motion.span
            key={i}
            className="absolute pointer-events-none rounded-[2px]"
            style={{ left: '50%', top: '44%', width: p.size, height: p.height, background: p.color }}
            initial={{ x: '-50%', y: '-50%', rotate: p.rotate, scale: 1, opacity: 1 }}
            animate={{ x: p.x, y: p.y, rotate: p.rotate, scale: 0.2, opacity: 0 }}
            transition={{ duration: 1.4, ease: [0.12, 0.7, 0.2, 1] }}
          />
        )
      })}

      <div className="relative text-center px-8" style={{ transform: 'translateY(-6%)' }}>
        <motion.div
          initial={reduced ? { opacity: 0 } : { scale: 0.2, rotate: -25, opacity: 0 }}
          animate={reduced ? { opacity: 1 } : { scale: 1, rotate: 0, opacity: 1 }}
          transition={reduced ? { duration: 0.2 } : { type: 'spring', stiffness: 380, damping: 16 }}
          className="text-[68px] leading-none"
          style={{ color: GOLD, filter: 'drop-shadow(0 0 28px rgba(245,178,62,0.7))' }}
        >
          ★
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.26, ease: EASE_OUT }}
          className="font-serif text-4xl text-white mt-2"
        >
          New best
        </motion.p>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.37, ease: EASE_OUT }}
          className="text-[13px] text-white/70 mt-3 max-w-[300px] mx-auto leading-relaxed"
        >
          {bw ? (
            <>You beat your record. Next time, arm the bump:{' '}
              <b style={{ color: GOLD }}>{best.reps + 1} reps</b>.</>
          ) : (
            <>You beat your record. Next time, arm the bump:{' '}
              <b style={{ color: GOLD }}>{fmtNum(best.weight + step)} {units}</b> or{' '}
              <b style={{ color: GOLD }}>{fmtNum(best.weight)} × {best.reps + 1}</b>.</>
          )}
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.9 }}
          className="text-[10px] tracking-[0.18em] uppercase text-white/25 mt-6"
        >
          tap anywhere to continue
        </motion.p>
      </div>
    </motion.div>
  )
}

export default function NewBestBurst(props: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  return createPortal(
    <AnimatePresence>
      {props.best && <Burst key={`${props.best.weight}-${props.best.reps}`} {...props} best={props.best} />}
    </AnimatePresence>,
    document.body
  )
}
