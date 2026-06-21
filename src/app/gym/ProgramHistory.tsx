'use client'

import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { usePrograms, useProgramDetail, useUpdateProgram, useDeleteProgram } from '@/features/gym/programQueries'
import type { TrainingProgram, ProgramPhase, ProgramStatus } from '@/features/gym/programTypes'

const PHASE_COLOR: Record<ProgramPhase, string> = {
  accumulation: '#22d3ee', deload: '#a1a1aa', intensification: '#fbbf24', peak: '#f87171',
}
const STATUS_STYLE: Record<ProgramStatus, { label: string; color: string }> = {
  active: { label: 'Active', color: '#4ade80' },
  archived: { label: 'Archived', color: '#71717a' },
  completed: { label: 'Done', color: '#22d3ee' },
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function ProgramDetail({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const { data, isLoading } = useProgramDetail(id)
  const updateProgram = useUpdateProgram()
  const deleteProgram = useDeleteProgram()
  const [selectedWeek, setSelectedWeek] = useState(1)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (isLoading || !data) {
    return <div className="py-16 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-green-400/30 border-t-green-400 animate-spin" /></div>
  }

  const { program, sessions } = data
  const weekSessions = sessions.filter(s => s.week_number === selectedWeek).sort((a, b) => a.session_number - b.session_number)
  const weekPhase = weekSessions[0]?.phase ?? null
  const status = STATUS_STYLE[program.status]

  const saveName = () => {
    const n = nameDraft.trim()
    if (n && n !== program.name) updateProgram.mutate({ id: program.id, name: n })
    setEditingName(false)
  }

  return (
    <div className="max-w-md mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[12.5px] text-zinc-400 mb-3 active:opacity-60">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        All programs
      </button>

      <div className="flex items-start justify-between gap-3 mb-1">
        {editingName ? (
          <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
            onBlur={saveName} onKeyDown={e => { if (e.key === 'Enter') saveName() }}
            className="flex-1 bg-white/8 border border-white/15 rounded-lg px-2 py-1 text-[16px] font-bold text-white focus:outline-none" />
        ) : (
          <button onClick={() => { setNameDraft(program.name); setEditingName(true) }} className="text-left text-[16px] font-bold text-white active:opacity-60">
            {program.name}
          </button>
        )}
        <span className="shrink-0 mt-1 text-[9.5px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
          style={{ color: status.color, background: `${status.color}1a`, border: `1px solid ${status.color}40` }}>
          {status.label}
        </span>
      </div>
      <p className="text-[12px] text-zinc-500 mb-3">
        {program.goal} · {program.duration_weeks} wks · {program.days_per_week}/wk · {program.structure === 'overlay' ? 'overlays your days' : 'standalone'}
        {program.start_date ? ` · started ${fmtDate(program.start_date)}` : ''}
      </p>

      {/* Week pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'none' }}>
        {Array.from({ length: program.duration_weeks }, (_, i) => i + 1).map(w => {
          const active = w === selectedWeek
          const ph = sessions.find(s => s.week_number === w)?.phase ?? null
          return (
            <button key={w} onClick={() => setSelectedWeek(w)}
              className="shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold transition-colors"
              style={active
                ? { background: 'rgba(74,222,128,0.16)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }
                : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#71717a' }}>
              W{w}{ph ? <span className="ml-1 w-1.5 h-1.5 rounded-full inline-block" style={{ background: PHASE_COLOR[ph] }} /> : null}
            </button>
          )
        })}
      </div>

      {weekPhase && (
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full" style={{ background: PHASE_COLOR[weekPhase] }} />
          <span className="text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: PHASE_COLOR[weekPhase] }}>{weekPhase}</span>
        </div>
      )}

      <div className="space-y-3">
        {weekSessions.map(s => (
          <div key={`${s.week_number}-${s.session_number}`} className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-bold text-zinc-100">{s.label}</span>
              <span className="text-[10px] text-zinc-600 font-mono">Day {s.session_number}</span>
            </div>
            <div className="space-y-1.5">
              {s.exercises.map((ex, i) => (
                <div key={i} className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px] text-zinc-300">{ex.name}{ex.is_new && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-green-400/70 align-middle">new</span>}</span>
                  <span className="text-[12px] text-zinc-500 tabular-nums shrink-0">{ex.sets}×{ex.rep_min}–{ex.rep_max}{ex.rpe ? ` @${ex.rpe}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2 mt-5">
        {program.status !== 'active' && (
          <button onClick={() => updateProgram.mutate({ id: program.id, status: 'active' })}
            disabled={updateProgram.isPending}
            className="flex-1 text-[13px] font-bold py-2.5 rounded-xl" style={{ background: '#4ade80', color: '#04210f' }}>
            {updateProgram.isPending ? '…' : 'Reactivate'}
          </button>
        )}
        {confirmDelete ? (
          <button onClick={() => deleteProgram.mutate(program.id, { onSuccess: onDeleted })}
            className="flex-1 text-[13px] font-bold py-2.5 rounded-xl text-red-300" style={{ background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.35)' }}>
            {deleteProgram.isPending ? 'Deleting…' : 'Tap again to delete'}
          </button>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="text-[13px] font-semibold py-2.5 px-4 rounded-xl text-zinc-400" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

function ProgramList({ onOpen }: { onOpen: (p: TrainingProgram) => void }) {
  const { data: programs = [], isLoading } = usePrograms()

  if (isLoading) return <div className="py-16 flex justify-center"><div className="w-6 h-6 rounded-full border-2 border-green-400/30 border-t-green-400 animate-spin" /></div>
  if (!programs.length) {
    return (
      <div className="max-w-md mx-auto py-16 text-center">
        <p className="text-sm text-zinc-400">No programs yet.</p>
        <p className="text-[12px] text-zinc-600 mt-1">Ask your gym coach to build one, or use “Generate a program” in settings.</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-2.5">
      {programs.map(p => {
        const status = STATUS_STYLE[p.status]
        return (
          <button key={p.id} onClick={() => onOpen(p)}
            className="w-full text-left rounded-2xl p-3.5 active:opacity-70"
            style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${p.status === 'active' ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.07)'}` }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[14px] font-bold text-white truncate">{p.name}</span>
              <span className="shrink-0 text-[9.5px] font-bold uppercase tracking-[0.12em] px-2 py-0.5 rounded-full"
                style={{ color: status.color, background: `${status.color}1a`, border: `1px solid ${status.color}40` }}>
                {status.label}
              </span>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1">
              {p.goal} · {p.duration_weeks} wks · {p.days_per_week}/wk{p.start_date ? ` · ${fmtDate(p.start_date)}` : ''}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// ─── Sheet ────────────────────────────────────────────────────────────────────

export default function ProgramHistory({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mounted, setMounted] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { if (!open) setDetailId(null) }, [open])

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose} className="fixed inset-0 z-[80]" style={{ background: 'rgba(0,0,0,0.6)' }} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 36 }}
            className="fixed left-0 right-0 bottom-0 z-[90] flex flex-col"
            style={{ height: '90vh', background: 'linear-gradient(180deg, rgba(10,12,16,0.99), rgba(6,7,10,1))', borderTop: '1px solid rgba(74,222,128,0.2)', borderRadius: '22px 22px 0 0' }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-zinc-300">Program History</p>
              <button onClick={onClose} className="p-1 text-zinc-500" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
              {detailId
                ? <ProgramDetail id={detailId} onBack={() => setDetailId(null)} onDeleted={() => setDetailId(null)} />
                : <ProgramList onOpen={p => setDetailId(p.id)} />}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
