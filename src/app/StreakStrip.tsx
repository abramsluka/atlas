'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import type { Streaks, StreakStat } from '@/lib/home/streaks'

// ─── Module config ────────────────────────────────────────────────────────────

type ModuleKey = keyof Streaks

interface ModuleDef {
  key: ModuleKey
  label: string
  href: string
  color: string
  icon: (props: { color: string }) => React.ReactElement
}

const stroke = { fill: 'none', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const MODULES: ModuleDef[] = [
  {
    key: 'training', label: 'Gym', href: '/gym', color: '#4ade80',
    icon: ({ color }) => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke={color} {...stroke}>
        <path d="M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11" />
      </svg>
    ),
  },
  {
    key: 'journal', label: 'Journal', href: '/journal', color: '#fbbf24',
    icon: ({ color }) => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke={color} {...stroke}>
        <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
        <path d="M8 7h7M8 11h7M8 15h4" />
      </svg>
    ),
  },
  {
    key: 'food', label: 'Food', href: '/health/food', color: '#22d3ee',
    icon: ({ color }) => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke={color} {...stroke}>
        <path d="M6 3v7M9 3v7M6 10a3 3 0 0 0 3-3M7.5 10v11" />
        <path d="M16.5 3c-1.4 0-2.5 2-2.5 5s1.1 4 2.5 4 2.5-1 2.5-4-1.1-5-2.5-5zM16.5 16v5" />
      </svg>
    ),
  },
  {
    key: 'supplements', label: 'Supps', href: '/health', color: '#a78bfa',
    icon: ({ color }) => (
      <svg width="18" height="18" viewBox="0 0 24 24" stroke={color} {...stroke}>
        <rect x="3" y="8" width="18" height="8" rx="4" />
        <path d="M12 8v8" />
      </svg>
    ),
  },
  // Water lives on the Habits page now (see MoreButton) — one auto habit there
  // among the manual ones, keeping the strip at five slots on mobile.
]

// ─── Cell ─────────────────────────────────────────────────────────────────────

function StreakCell({ def, stat }: { def: ModuleDef; stat: StreakStat }) {
  const router = useRouter()
  const active = stat.streak > 0
  const color = active ? def.color : 'rgba(255,255,255,0.22)'

  return (
    <motion.button
      onClick={() => router.push(def.href)}
      whileTap={{ scale: 0.93 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col items-center gap-1 flex-1 min-w-0"
    >
      <def.icon color={color} />
      <span
        className="text-[14px] font-bold leading-none tabular-nums"
        style={{ color: active ? def.color : 'rgba(255,255,255,0.3)' }}
      >
        {stat.streak}<span className="text-[10px] font-semibold opacity-70">d</span>
      </span>
      <span
        className="text-[8.5px] font-bold tracking-[0.16em] uppercase leading-none"
        style={{ color: active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.22)' }}
      >
        {def.label}
      </span>
      {/* weekly consistency bar */}
      <div className="w-[26px] h-[3px] rounded-full overflow-hidden mt-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${stat.weeklyPct}%`, background: active ? def.color : 'rgba(255,255,255,0.18)', opacity: 0.7 }}
        />
      </div>
    </motion.button>
  )
}

// ─── More button ──────────────────────────────────────────────────────────────
// The door to the full Habits page. Takes an equal column like the four streaks
// (even spacing), a glowing green chevron that breathes so it reads as live.

function MoreButton() {
  const router = useRouter()
  return (
    <motion.button
      onClick={() => router.push('/habits')}
      whileTap={{ scale: 0.9 }}
      whileHover="hover"
      initial="rest"
      animate="rest"
      className="flex flex-col items-center justify-center flex-1 min-w-0"
      aria-label="Open Habits"
    >
      <motion.span
        className="flex items-center justify-center"
        variants={{ rest: { borderColor: 'rgba(74,222,128,0.42)' }, hover: { borderColor: 'rgba(74,222,128,0.85)' } }}
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          borderWidth: 1,
          borderStyle: 'solid',
          background: 'radial-gradient(120% 120% at 50% 25%, rgba(74,222,128,0.16), rgba(74,222,128,0.03) 62%, transparent)',
          animation: 'cosmicPulseGlow 3.6s ease-in-out infinite',
        }}
      >
        <motion.svg
          width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#eafff2"
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          variants={{ rest: { x: 0 }, hover: { x: 2 } }}
          style={{ filter: 'drop-shadow(0 0 5px rgba(74,222,128,0.6))' }}
        >
          <polyline points="8 6 14 12 8 18" />
          <polyline points="13 6 19 12 13 18" />
        </motion.svg>
      </motion.span>
    </motion.button>
  )
}

// ─── Strip ──────────────────────────────────────────────────────────────────

function StripShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="cosmic-card px-3 py-3.5 mb-4">
      <div className="flex items-stretch justify-between gap-1">{children}</div>
    </div>
  )
}

export default function StreakStrip({ initial }: { initial?: Streaks }) {
  const [data, setData] = useState<Streaks | null>(initial ?? null)

  useEffect(() => {
    if (initial) return
    let cancelled = false
    fetch('/api/home/streaks', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [initial])

  if (!data) {
    return (
      <StripShell>
        {MODULES.map(def => (
          <div key={def.key} className="flex flex-col items-center gap-1 flex-1">
            <div className="w-[18px] h-[18px] rounded-full bg-white/[0.06] animate-pulse" />
            <div className="w-5 h-3 rounded bg-white/[0.06] animate-pulse" />
            <div className="w-7 h-2 rounded bg-white/[0.04] animate-pulse" />
          </div>
        ))}
        <MoreButton />
      </StripShell>
    )
  }

  return (
    <StripShell>
      {MODULES.map(def => (
        <StreakCell key={def.key} def={def} stat={data[def.key]} />
      ))}
      <MoreButton />
    </StripShell>
  )
}
