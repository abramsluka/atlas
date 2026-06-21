'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useActiveProgram, useUpdateProgram } from '@/features/gym/programQueries'
import type { ProgramSession, ProgramPhase, ActiveProgramResponse } from '@/features/gym/programTypes'

const PHASE_COLOR: Record<ProgramPhase, string> = {
  accumulation: '#22d3ee', deload: '#a1a1aa', intensification: '#fbbf24', peak: '#f87171',
}

function ExerciseRow({ ex, done }: { ex: ProgramSession['exercises'][number]; done: number | null }) {
  const target = ex.sets
  const complete = done != null && done >= target
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-zinc-300">
        {ex.name}{ex.is_new && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-green-400/70 align-middle">new</span>}
      </span>
      <span className="text-[12px] tabular-nums shrink-0 flex items-center gap-1.5">
        <span className="text-zinc-500">{ex.sets}×{ex.rep_min}–{ex.rep_max}{ex.rpe ? ` @${ex.rpe}` : ''}</span>
        {done != null && done > 0 && (
          complete
            ? <span className="text-green-400 font-bold">✓</span>
            : <span className="text-amber-400/80 font-semibold text-[11px]">{done}/{target}</span>
        )}
      </span>
    </div>
  )
}

function SessionBlock({ s, todayCountByEx, isToday }: { s: ProgramSession; todayCountByEx: Record<string, number>; isToday: boolean }) {
  return (
    <div className="rounded-2xl p-3.5" style={{
      background: isToday ? 'rgba(74,222,128,0.05)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${isToday ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.06)'}`,
    }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-bold text-zinc-100">{s.label}</span>
        {isToday && <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-green-400">Today</span>}
      </div>
      <div className="space-y-1.5">
        {s.exercises.map((ex, i) => (
          <ExerciseRow key={i} ex={ex} done={isToday && ex.exercise_id ? (todayCountByEx[ex.exercise_id] ?? 0) : null} />
        ))}
      </div>
    </div>
  )
}

export default function ActiveProgramCard({ todayDayId, todayCountByEx, onOpenHistory }: { todayDayId: string | null; todayCountByEx: Record<string, number>; onOpenHistory: () => void }) {
  const { data, isLoading } = useActiveProgram()
  const updateProgram = useUpdateProgram()
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  if (isLoading || !data || !('program' in data) || !data.program) return null

  const { program, currentWeek, weekSessions } = data as ActiveProgramResponse
  if (!weekSessions.length) return null

  // Pick today's session: overlay → match today's day; standalone → first in week.
  const todaySession = program.structure === 'overlay'
    ? (weekSessions.find(s => s.day_id && s.day_id === todayDayId) ?? null)
    : (weekSessions[0] ?? null)

  const phase = (todaySession?.phase ?? weekSessions[0]?.phase ?? null) as ProgramPhase | null
  const shown = expanded ? weekSessions : (todaySession ? [todaySession] : weekSessions.slice(0, 1))

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30">Active Program</span>
        <div className="relative">
          <button onClick={() => setMenuOpen(v => !v)} className="text-white/30 px-1 active:opacity-50" aria-label="Program menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-10 rounded-xl overflow-hidden min-w-[150px]" style={{ background: '#14161b', border: '1px solid rgba(255,255,255,0.1)' }}>
              <button
                onClick={() => { onOpenHistory(); setMenuOpen(false) }}
                className="block w-full text-left text-[12.5px] text-zinc-300 px-3.5 py-2.5 active:bg-white/5 border-b border-white/5">
                Program history
              </button>
              <button
                onClick={() => { updateProgram.mutate({ id: program.id, status: 'archived' }); setMenuOpen(false) }}
                className="block w-full text-left text-[12.5px] text-zinc-300 px-3.5 py-2.5 active:bg-white/5">
                End program
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="cosmic-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-bold text-white">{program.name}</span>
          <span className="text-[11px] font-mono text-zinc-500">Wk {currentWeek}/{program.duration_weeks}</span>
        </div>
        {phase && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: PHASE_COLOR[phase] }} />
            <span className="text-[10px] font-bold tracking-[0.14em] uppercase" style={{ color: PHASE_COLOR[phase] }}>{phase}</span>
          </div>
        )}

        <div className="mt-3 space-y-2.5">
          <AnimatePresence initial={false}>
            {shown.map(s => (
              <motion.div key={`${s.week_number}-${s.session_number}`}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <SessionBlock s={s} todayCountByEx={todayCountByEx} isToday={!!todaySession && s.session_number === todaySession.session_number} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {weekSessions.length > 1 && (
          <button onClick={() => setExpanded(v => !v)} className="mt-3 text-[11.5px] font-semibold text-green-400/70 active:opacity-50">
            {expanded ? 'Show today only' : `Show full week (${weekSessions.length} days)`}
          </button>
        )}
      </div>
    </div>
  )
}
