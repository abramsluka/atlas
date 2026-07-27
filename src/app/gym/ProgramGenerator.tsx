'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useGenerateProgram, useSaveProgram } from '@/features/gym/programQueries'
import { NoApiKeyClientError, AiLimitClientError } from '@/lib/apiKeyError'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'
import AiLimitNotice from '@/components/AiLimitNotice'
import type {
  GeneratedProgram, ProgramGoal, ProgramStructure, ProgramPhase, GenerateProgramRequest,
} from '@/features/gym/programTypes'

export interface GeneratorPrefill {
  goal: ProgramGoal
  duration_weeks: number
  days_per_week: number
  structure: ProgramStructure
  auto?: boolean
}

const GOALS: { v: ProgramGoal; label: string }[] = [
  { v: 'strength', label: 'Strength' },
  { v: 'hypertrophy', label: 'Hypertrophy' },
  { v: 'recomp', label: 'Recomp' },
]
const PHASE_COLOR: Record<ProgramPhase, string> = {
  accumulation: '#22d3ee', deload: '#a1a1aa', intensification: '#fbbf24', peak: '#f87171',
}

function Seg<T extends string | number>({ options, value, onChange }: { options: { v: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5">
      {options.map(o => {
        const active = o.v === value
        return (
          <button key={String(o.v)} onClick={() => onChange(o.v)}
            className="flex-1 text-[12.5px] font-semibold py-2 rounded-xl transition-colors"
            style={active
              ? { background: 'rgba(74,222,128,0.16)', border: '1px solid rgba(74,222,128,0.4)', color: '#4ade80' }
              : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#a1a1aa' }}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500 mb-2">{children}</p>
}

export default function ProgramGenerator({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill: GeneratorPrefill | null }) {
  const [mounted, setMounted] = useState(false)
  const [goal, setGoal] = useState<ProgramGoal>('hypertrophy')
  const [weeks, setWeeks] = useState(8)
  const [days, setDays] = useState(4)
  const [structure, setStructure] = useState<ProgramStructure>('overlay')
  const [step, setStep] = useState<'config' | 'preview'>('config')
  const [program, setProgram] = useState<GeneratedProgram | null>(null)
  const [selectedWeek, setSelectedWeek] = useState(1)
  const autoFired = useRef(false)

  const gen = useGenerateProgram()
  const save = useSaveProgram()

  useEffect(() => { setMounted(true) }, [])

  // Apply prefill + optionally auto-generate when opened from the coach.
  useEffect(() => {
    if (!open) { autoFired.current = false; setStep('config'); setProgram(null); gen.reset(); save.reset(); return }
    if (prefill && !autoFired.current) {
      setGoal(prefill.goal); setWeeks(prefill.duration_weeks); setDays(prefill.days_per_week); setStructure(prefill.structure)
      if (prefill.auto) { autoFired.current = true; void runGenerate(prefill) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill])

  async function runGenerate(over?: Partial<GenerateProgramRequest>) {
    const req: GenerateProgramRequest = {
      goal: (over?.goal ?? goal), duration_weeks: (over?.duration_weeks ?? weeks),
      days_per_week: (over?.days_per_week ?? days), structure: (over?.structure ?? structure),
    }
    try {
      const result = await gen.mutateAsync(req)
      setProgram(result); setSelectedWeek(1); setStep('preview')
    } catch { /* error surfaced via gen.isError */ }
  }

  async function handleSave() {
    if (!program) return
    try { await save.mutateAsync(program); onClose() } catch { /* surfaced */ }
  }

  if (!mounted) return null

  const weekSessions = program?.sessions.filter(s => s.week_number === selectedWeek).sort((a, b) => a.session_number - b.session_number) ?? []
  const weekPhase = weekSessions[0]?.phase ?? null

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
            style={{
              height: '90vh', background: 'linear-gradient(180deg, rgba(10,12,16,0.99), rgba(6,7,10,1))',
              borderTop: '1px solid rgba(74,222,128,0.2)', borderRadius: '22px 22px 0 0',
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <div>
                <p className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-zinc-300">
                  {step === 'config' ? 'Generate Program' : 'Preview'}
                </p>
                {step === 'preview' && program && <p className="text-[13px] text-zinc-400 mt-0.5">{program.name}</p>}
              </div>
              <button onClick={onClose} className="p-1 text-zinc-500" aria-label="Close">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {step === 'config' && (
                <div className="space-y-5 max-w-md mx-auto">
                  {gen.isPending ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-16">
                      <motion.div className="w-8 h-8 rounded-full border-2 border-green-400/30 border-t-green-400"
                        animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} />
                      <p className="text-sm text-zinc-400">Building your {weeks}-week block…</p>
                    </div>
                  ) : (
                    <>
                      <div><Label>Goal</Label><Seg options={GOALS} value={goal} onChange={setGoal} /></div>
                      <div><Label>Duration</Label><Seg options={[{ v: 4, label: '4 wks' }, { v: 6, label: '6 wks' }, { v: 8, label: '8 wks' }]} value={weeks} onChange={setWeeks} /></div>
                      <div><Label>Days / week</Label><Seg options={[{ v: 3, label: '3' }, { v: 4, label: '4' }, { v: 5, label: '5' }]} value={days} onChange={setDays} /></div>
                      <div>
                        <Label>Structure</Label>
                        <Seg options={[{ v: 'overlay' as ProgramStructure, label: 'Overlay my days' }, { v: 'standalone' as ProgramStructure, label: 'Standalone plan' }]} value={structure} onChange={setStructure} />
                        <p className="text-[11.5px] text-zinc-500 mt-2 leading-relaxed">
                          {structure === 'overlay'
                            ? 'Layers each week’s sets/reps/phase onto your existing Push/Pull/Legs days and their exercises.'
                            : 'Builds its own session plan, separate from your current days. Can introduce new exercises.'}
                        </p>
                      </div>
                      {gen.isError && (
                        gen.error instanceof NoApiKeyClientError
                          ? <NoApiKeyNotice provider={gen.error.provider} />
                          : gen.error instanceof AiLimitClientError
                            ? <AiLimitNotice />
                            : <p className="text-[12.5px] text-red-400">{(gen.error as Error)?.message ?? 'Generation failed.'}</p>
                      )}
                      <button onClick={() => runGenerate()} disabled={gen.isPending}
                        className="w-full py-3 rounded-xl text-[14px] font-bold" style={{ background: '#4ade80', color: '#04210f' }}>
                        Generate
                      </button>
                      <p className="text-[11px] text-zinc-600 text-center">Periodization only — your weight progression stays driven by your logs.</p>
                    </>
                  )}
                </div>
              )}

              {step === 'preview' && program && (
                <div className="max-w-md mx-auto">
                  {program.notes && <p className="text-[12.5px] text-zinc-400 leading-relaxed mb-3">{program.notes}</p>}

                  {/* Week pills */}
                  <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: 'none' }}>
                    {Array.from({ length: program.duration_weeks }, (_, i) => i + 1).map(w => {
                      const active = w === selectedWeek
                      const ph = program.sessions.find(s => s.week_number === w)?.phase ?? null
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
                              <span className="text-[13px] text-zinc-300">
                                {ex.name}{ex.is_new && <span className="ml-1.5 text-[9px] font-bold uppercase tracking-wider text-green-400 align-middle">new</span>}
                              </span>
                              <span className="text-[12px] text-zinc-500 tabular-nums shrink-0">
                                {ex.sets}×{ex.rep_min}–{ex.rep_max}{ex.rpe ? ` @${ex.rpe}` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {save.isError && <p className="text-[12.5px] text-red-400 mt-3">Couldn’t save. Try again.</p>}
                </div>
              )}
            </div>

            {/* Footer actions (preview) */}
            {step === 'preview' && program && (
              <div className="shrink-0 flex gap-2 px-5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}>
                <button onClick={() => { setStep('config') }} disabled={save.isPending}
                  className="text-[13px] font-semibold py-3 px-4 rounded-xl text-zinc-300" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  Adjust
                </button>
                <button onClick={() => runGenerate()} disabled={gen.isPending || save.isPending}
                  className="text-[13px] font-semibold py-3 px-4 rounded-xl text-zinc-300" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  {gen.isPending ? '…' : 'Regenerate'}
                </button>
                <button onClick={handleSave} disabled={save.isPending}
                  className="flex-1 text-[14px] font-bold py-3 rounded-xl" style={{ background: '#4ade80', color: '#04210f' }}>
                  {save.isPending ? 'Saving…' : 'Save & activate'}
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
