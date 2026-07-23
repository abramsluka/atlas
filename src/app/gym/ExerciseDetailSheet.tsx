'use client'

// The exercise pop-up: ONE bottom sheet, tabbed History (default) | How-to.
// Opens from the hero (name tap / detail button). Design locked in
// specs/gym/EXERCISE_HISTORY_SPEC.md + exercise-history-lab.html.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useGymLogs } from '@/features/gym/queries'
import type { GymExercise } from '@/features/gym/types'
import type { Timeframe } from '@/features/gym/history'
import {
  groupSessions, chartSessions, bestRecord, last30Delta, nextTarget, fmtSessionDate,
} from '@/features/gym/history'
import ProgressionChart from './ProgressionChart'
import { HowToContent } from './ExerciseInfoSheet'
import { SPRING_SHEET, SPRING_SNAPPY, EASE_OUT } from './motion'

const GREEN = '#4ade80'
const GOLD = '#f5b23e'
const RED = '#f87171'

export type DetailTab = 'history' | 'howto'

interface Props {
  exerciseId: string | null
  exercise: GymExercise | null
  units: string
  showNextTarget: boolean
  initialTab?: DetailTab
  onLogSession: (exId: string) => void
  onClose: () => void
}

const fmtNum = (n: number) => String(+n.toFixed(2)).replace(/\.0+$/, '')

// Eases a stat from 0 to its target on mount (~900ms), snapped to `snap`.
function CountUp({ target, snap, suffix }: { target: number; snap: number; suffix?: string }) {
  const reduced = useReducedMotion()
  const [shown, setShown] = useState(reduced ? target : 0)
  useEffect(() => {
    if (reduced) { setShown(target); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900)
      const e = 1 - Math.pow(1 - k, 3)
      setShown(k < 1 ? Math.round(target * e / snap) * snap : target)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, snap, reduced])
  return <>{fmtNum(shown)}{suffix}</>
}

function SheetBody({ exercise, units, showNextTarget, initialTab, onLogSession, onClose }: {
  exercise: GymExercise
  units: string
  showNextTarget: boolean
  initialTab: DetailTab
  onLogSession: (exId: string) => void
  onClose: () => void
}) {
  const reduced = useReducedMotion()
  const { data: logs = [], isLoading } = useGymLogs(exercise.id)
  const hasHowTo = !!exercise.library_id
  const [tab, setTab] = useState<DetailTab>(initialTab === 'howto' && hasHowTo ? 'howto' : 'history')
  const [tf, setTf] = useState<Timeframe>('ALL')

  const sessions = useMemo(() => groupSessions(logs, exercise), [logs, exercise])
  const visibleCount = useMemo(() => chartSessions(sessions, tf).length, [sessions, tf])
  const best = useMemo(() => bestRecord(logs, exercise), [logs, exercise])
  const l30 = useMemo(() => last30Delta(sessions), [sessions])
  const target = best ? nextTarget(best, exercise) : null
  const unit = exercise.bodyweight ? 'reps' : units
  const snap = exercise.bodyweight ? 1 : (exercise.step || 2.5)
  const newestFirst = useMemo(() => [...sessions].reverse(), [sessions])

  // one-time gold shimmer across the BEST tile
  const bestShimmerRef = useRef<HTMLDivElement>(null)

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
        className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-[#111] border-t border-white/10 max-h-[88vh] flex flex-col"
      >
        <div className="shrink-0 pt-3 pb-1 flex justify-center" style={{ touchAction: 'none' }}>
          <div className="w-9 h-1 rounded-full bg-white/15" />
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pb-10">
          {/* Header — exercise name only, no "history" kicker (tab strip signals the view) */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-2xl font-bold text-white leading-tight">{exercise.name}</h2>
            <button onClick={onClose} className="text-white/40 text-2xl leading-none shrink-0">×</button>
          </div>

          {/* Tab strip */}
          {hasHowTo && (
            <div className="inline-flex rounded-full p-[3px] mb-4" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {(['history', 'howto'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="relative px-4 py-1.5 text-xs rounded-full"
                  style={{ color: tab === t ? '#08120b' : 'rgba(255,255,255,0.45)' }}
                >
                  {tab === t && (
                    <motion.span
                      layoutId="detail-tab-pill"
                      transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
                      className="absolute inset-0 rounded-full"
                      style={{ background: GREEN }}
                    />
                  )}
                  <span className={`relative z-10 ${tab === t ? 'font-semibold' : ''}`}>
                    {t === 'history' ? 'History' : 'How-to'}
                  </span>
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {tab === 'howto' && exercise.library_id ? (
              <motion.div
                key="howto"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
              >
                <HowToContent id={exercise.library_id} showTitle={false} />
              </motion.div>
            ) : (
              <motion.div
                key="history"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
              >
                {isLoading ? (
                  <div className="space-y-4 py-2 animate-pulse">
                    <div className="h-8 w-full rounded-xl bg-white/5" />
                    <div className="h-40 w-full rounded-2xl bg-white/5" />
                    <div className="h-16 w-full rounded-xl bg-white/5" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="font-serif italic text-white/40 text-lg mb-5">No history yet</p>
                    <button
                      onClick={() => onLogSession(exercise.id)}
                      className="w-full py-3 rounded-xl border border-dashed border-white/15 text-sm text-white/50 active:border-[rgba(74,222,128,0.4)] active:text-[#4ade80]"
                    >
                      + log a session
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Chart card */}
                    <div className="rounded-2xl p-3.5 pb-3 mb-4" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'linear-gradient(180deg, rgba(255,255,255,0.02), transparent)' }}>
                      <ProgressionChart
                        sessions={sessions}
                        bodyweight={exercise.bodyweight}
                        units={units}
                        step={exercise.step || 2.5}
                        tf={tf}
                        onTfChange={setTf}
                      />
                    </div>

                    {/* Next-target card */}
                    {showNextTarget && best && target && (
                      <motion.div
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, ease: EASE_OUT, delay: 0.1 }}
                        className="relative overflow-hidden flex items-center gap-2.5 rounded-xl px-3.5 py-3 mb-4"
                        style={{ border: '1px solid rgba(245,178,62,0.28)', background: 'rgba(245,178,62,0.12)' }}
                      >
                        <span style={{ color: GOLD }} className="text-[15px]">★</span>
                        <span className="text-xs leading-snug text-white/80">
                          {exercise.bodyweight ? (
                            <>Your best is <b className="text-white">{best.weight} reps</b>. Beat it next session: <b style={{ color: GOLD }}>{target.repTarget} reps</b>.</>
                          ) : (
                            <>Your best is <b className="text-white">{fmtNum(best.weight)} {units} × {best.reps}</b>. Beat it next session: <b style={{ color: GOLD }}>{fmtNum(target.weightTarget)} {units}</b>, or <b style={{ color: GOLD }}>{fmtNum(best.weight)} × {target.repTarget}</b>.</>
                          )}
                        </span>
                        {!reduced && (
                          <motion.span
                            className="absolute inset-0 pointer-events-none"
                            style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)' }}
                            initial={{ x: '-120%' }}
                            animate={{ x: '120%' }}
                            transition={{ duration: 1.4, delay: 0.5, ease: 'easeInOut' }}
                          />
                        )}
                      </motion.div>
                    )}

                    {/* Stat tiles */}
                    <div className="grid grid-cols-3 gap-2 mb-5">
                      {[
                        { k: 'Sessions', v: <CountUp target={visibleCount} snap={1} />, gold: false },
                        { k: 'Last 30 days', v: l30 === null ? '—' : <>{l30 >= 0 ? '+' : ''}<CountUp target={l30} snap={snap} suffix={` ${unit}`} /></>, gold: false },
                        { k: 'Best', v: best ? <CountUp target={best.weight} snap={snap} suffix={exercise.bodyweight ? ' reps' : ` ${units}`} /> : '—', gold: true },
                      ].map(({ k, v, gold }) => (
                        <div
                          key={k}
                          ref={gold ? bestShimmerRef : undefined}
                          className="relative overflow-hidden rounded-xl py-3 px-1 text-center"
                          style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)' }}
                        >
                          <p className="text-[8.5px] font-mono tracking-[0.16em] uppercase text-white/25">{k}</p>
                          <p className="font-serif text-lg mt-1" style={{ color: gold ? GOLD : '#fff' }}>{v}</p>
                          {gold && !reduced && (
                            <motion.span
                              className="absolute inset-0 pointer-events-none"
                              style={{ background: 'linear-gradient(100deg, transparent 40%, rgba(255,255,255,0.25) 50%, transparent 60%)' }}
                              initial={{ x: '-140%' }}
                              animate={{ x: '160%' }}
                              transition={{ duration: 1.6, delay: 0.9, ease: EASE_OUT }}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Session table — newest first; swapped days greyed */}
                    <div className="grid grid-cols-[1.1fr_.55fr_.55fr_1fr_.9fr] items-center py-2 border-b border-white/10 text-[8.5px] font-mono tracking-[0.14em] uppercase text-white/25">
                      <span>Date</span><span>Sets</span><span>Reps</span><span>Weight</span><span>Progress</span>
                    </div>
                    {newestFirst.map((s, i) => (
                      <motion.div
                        key={s.dateKey}
                        initial={reduced ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: s.swapped ? 0.5 : 1, y: 0 }}
                        transition={{ duration: 0.35, delay: reduced ? 0 : Math.min(i, 10) * 0.045, ease: EASE_OUT }}
                        className="grid grid-cols-[1.1fr_.55fr_.55fr_1fr_.9fr] items-center py-2.5 border-b border-white/[0.05] text-[13px]"
                      >
                        <span className="font-serif italic text-white/45">
                          {fmtSessionDate(s.dateKey)}
                          {s.swapped && <span className="block font-sans not-italic text-[9px] text-white/25">swapped</span>}
                        </span>
                        <span>{s.setCount}</span>
                        <span>{s.repsAtTop}</span>
                        <span>
                          {exercise.bodyweight
                            ? <b>{s.topWeight}</b>
                            : <><b>{fmtNum(s.topWeight)}</b> <span className="text-white/40 text-[11px]">{units}</span></>}
                        </span>
                        <span className="font-mono text-[11px]" style={{
                          color: s.swapped ? 'rgba(255,255,255,0.4)'
                            : s.deltaWeight === null ? 'rgba(255,255,255,0.3)'
                            : s.deltaWeight > 0 ? GREEN
                            : s.deltaWeight < 0 ? RED
                            : 'rgba(255,255,255,0.3)'
                        }}>
                          {s.swapped
                            ? s.swapped
                            : s.deltaWeight === null ? 'first'
                            : s.deltaWeight === 0 ? '—'
                            : `${s.deltaWeight > 0 ? '+' : ''}${fmtNum(s.deltaWeight)}`}
                        </span>
                      </motion.div>
                    ))}

                    <button
                      onClick={() => onLogSession(exercise.id)}
                      className="w-full mt-4 py-3 rounded-xl border border-dashed border-white/15 text-sm text-white/50 active:border-[rgba(74,222,128,0.4)] active:text-[#4ade80]"
                    >
                      + log a session
                    </button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </>
  )
}

export default function ExerciseDetailSheet({ exerciseId, exercise, units, showNextTarget, initialTab = 'history', onLogSession, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {exerciseId && exercise && (
        <SheetBody
          key={exerciseId + initialTab}
          exercise={exercise}
          units={units}
          showNextTarget={showNextTarget}
          initialTab={initialTab}
          onLogSession={onLogSession}
          onClose={onClose}
        />
      )}
    </AnimatePresence>,
    document.body
  )
}
