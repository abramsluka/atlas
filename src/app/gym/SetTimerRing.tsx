'use client'

import { motion } from 'framer-motion'

export type TimerPhase = 'idle' | 'active' | 'rest'

export function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const RING: Record<TimerPhase, { label: string; text: string; conic: string; glow: number }> = {
  active: {
    label: 'ACTIVE',
    text: '#4ade80',
    conic: 'conic-gradient(from 140deg, #22d3ee, #38bdf8 25%, #3b82f6 50%, #4ade80 78%, #22d3ee)',
    glow: 0.55,
  },
  rest: {
    label: 'REST',
    text: 'rgba(255,255,255,0.92)',
    conic: 'conic-gradient(from 140deg, rgba(255,255,255,0.55), rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.55))',
    glow: 0.14,
  },
  idle: {
    label: 'READY',
    text: 'rgba(255,255,255,0.35)',
    conic: 'conic-gradient(from 140deg, rgba(255,255,255,0.22), rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.22))',
    glow: 0.06,
  },
}

const RING_MASK = 'radial-gradient(farthest-side, transparent calc(100% - 8px), #000 calc(100% - 8px))'

export default function SetTimerRing({ phase, ms }: { phase: TimerPhase; ms: number }) {
  const c = RING[phase]
  const active = phase === 'active'

  return (
    <div className="relative mx-auto" style={{ width: 240, height: 240 }}>
      {/* glow */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{ opacity: c.glow }}
        transition={{ duration: 0.5 }}
        style={{ background: c.conic, filter: 'blur(22px)' }}
      />
      {/* rotating ring */}
      <motion.div
        className="absolute inset-0 rounded-full"
        animate={{ rotate: active ? 360 : 0 }}
        transition={active ? { duration: 8, ease: 'linear', repeat: Infinity } : { duration: 0.5, ease: 'easeOut' }}
        style={{ background: c.conic, WebkitMask: RING_MASK, mask: RING_MASK }}
      />
      {/* inner disc */}
      <div
        className="absolute rounded-full"
        style={{
          inset: 12,
          background: 'radial-gradient(circle at 50% 45%, rgba(14,14,17,0.85), rgba(8,8,10,0.96))',
          boxShadow: 'inset 0 0 30px rgba(0,0,0,0.6)',
        }}
      />
      {/* center */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          key={c.label}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="text-[13px] font-bold tracking-[0.22em] mb-1.5"
          style={{ color: c.text }}
        >
          {c.label}
        </motion.span>
        <span
          className="text-[44px] leading-none font-bold tabular-nums"
          style={{
            color: c.text,
            fontVariantNumeric: 'tabular-nums',
            textShadow: active ? '0 0 18px rgba(74,222,128,0.45)' : 'none',
          }}
        >
          {fmtClock(ms)}
        </span>
      </div>
    </div>
  )
}
