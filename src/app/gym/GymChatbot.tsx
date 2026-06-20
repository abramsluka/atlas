'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useGymConfig, useGymExercises, useAllGymLogs } from '@/features/gym/queries'
import { useLogSet, useCreateExercise, useUpdateExercise, useDeleteExercise, useSaveGymConfig } from '@/features/gym/mutations'
import type { GymCoachAction, CoachStreamEvent } from '@/features/gym/coachActions'
import type { GymExercise } from '@/features/gym/types'
import ChatText from '@/components/ChatText'
import { usePersistentChat } from '@/lib/usePersistentChat'

type ActionStatus = 'pending' | 'done' | 'dismissed' | 'error'
interface ProposedAction { id: string; action: GymCoachAction; status: ActionStatus }
interface CoachMsg { id: string; role: 'user' | 'assistant'; content: string; actions?: ProposedAction[] }

// ─── Action descriptions ──────────────────────────────────────────────────────

function describeAction(a: GymCoachAction, units: string): { title: string; detail: string; confirmLabel: string; doneLabel: string } {
  switch (a.kind) {
    case 'log_set':
      return { title: `Log ${a.exercise_name}`, detail: `${a.weight} ${units} × ${a.reps} reps`, confirmLabel: 'Log it', doneLabel: 'Logged' }
    case 'adjust_exercise': {
      const bits: string[] = []
      if (a.rep_min != null || a.rep_max != null) bits.push(`reps ${a.rep_min ?? '·'}–${a.rep_max ?? '·'}`)
      if (a.step != null) bits.push(`step +${a.step}`)
      return { title: `Adjust ${a.exercise_name}`, detail: bits.join(' · ') || 'update targets', confirmLabel: 'Apply', doneLabel: 'Updated' }
    }
    case 'add_exercise':
      return { title: `Add ${a.name}`, detail: `to ${a.day_label} · ${a.rep_min}–${a.rep_max} reps`, confirmLabel: 'Add it', doneLabel: 'Added' }
    case 'remove_exercise':
      return { title: `Remove ${a.exercise_name}`, detail: 'from your catalog', confirmLabel: 'Remove', doneLabel: 'Removed' }
    case 'swap_exercise':
      return { title: `Swap ${a.out_name} → ${a.in_name}`, detail: `in ${a.day_label}`, confirmLabel: 'Swap', doneLabel: 'Swapped' }
    case 'propose_workout':
      return {
        title: a.day_name,
        detail: `${a.exercises.length} exercise${a.exercises.length === 1 ? '' : 's'} → ${a.existing_day_id ? 'existing day' : 'new day'}`,
        confirmLabel: 'Add to my days', doneLabel: 'Added to your days',
      }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GymChatbot({ currentExId }: { currentExId: string | null }) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = usePersistentChat<CoachMsg>('atlas-gym-coach-thread-v1', 40)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const { data: config } = useGymConfig()
  const { data: exercises = [] } = useGymExercises()
  const { data: allLogs = [] } = useAllGymLogs()
  const units = config?.units ?? 'lbs'

  const logSet = useLogSet()
  const createEx = useCreateExercise()
  const updateEx = useUpdateExercise()
  const deleteEx = useDeleteExercise()
  const saveConfig = useSaveGymConfig()

  useEffect(() => { setMounted(true) }, [])

  // Auto-scroll
  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, streaming])

  const focusEx = currentExId ? exercises.find(e => e.id === currentExId) ?? null : null
  const focusLast = focusEx
    ? allLogs.filter(l => l.exercise_id === focusEx.id).sort((a, b) => b.logged_at.localeCompare(a.logged_at))[0]
    : null

  const updateMsg = (id: string, fn: (m: CoachMsg) => CoachMsg) =>
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m)))

  // ── Execute a confirmed action via the same TanStack mutations the page uses ──
  const nextOrder = useCallback(() => (exercises.length ? Math.max(...exercises.map(e => e.order_index)) + 1 : 0), [exercises])

  async function executeAction(msgId: string, pa: ProposedAction) {
    const a = pa.action
    try {
      if (a.kind === 'log_set') {
        await logSet.mutateAsync({ exercise_id: a.exercise_id, weight: a.weight, reps: a.reps })
      } else if (a.kind === 'adjust_exercise') {
        const upd: Partial<GymExercise> & { id: string } = { id: a.exercise_id }
        if (a.rep_min != null) upd.rep_min = a.rep_min
        if (a.rep_max != null) upd.rep_max = a.rep_max
        if (a.step != null) upd.step = a.step
        await updateEx.mutateAsync(upd)
      } else if (a.kind === 'add_exercise') {
        await createEx.mutateAsync({
          name: a.name, gym_id: a.gym_id, day_ids: a.day_ids, bodyweight: a.bodyweight,
          start_weight: 0, rep_min: a.rep_min, rep_max: a.rep_max, step: a.step, order_index: nextOrder(),
        })
      } else if (a.kind === 'remove_exercise') {
        await deleteEx.mutateAsync(a.exercise_id)
      } else if (a.kind === 'swap_exercise') {
        await deleteEx.mutateAsync(a.out_exercise_id)
        await createEx.mutateAsync({
          name: a.in_name, gym_id: a.gym_id, day_ids: a.day_ids, bodyweight: a.bodyweight,
          start_weight: 0, rep_min: a.rep_min, rep_max: a.rep_max, step: a.step, order_index: nextOrder(),
        })
      } else if (a.kind === 'propose_workout') {
        let dayId = a.existing_day_id
        if (!dayId && config) {
          const newDay = { id: `d_${Date.now()}`, name: a.day_name }
          await saveConfig.mutateAsync({ ...config, days: [...config.days, newDay] })
          dayId = newDay.id
        }
        if (!dayId) throw new Error('no day')
        let order = nextOrder()
        for (const ex of a.exercises) {
          await createEx.mutateAsync({
            name: ex.name, gym_id: a.gym_id, day_ids: [dayId], bodyweight: ex.bodyweight,
            start_weight: 0, rep_min: ex.rep_min, rep_max: ex.rep_max, step: ex.step, order_index: order++,
          })
        }
      }
      updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === pa.id ? { ...x, status: 'done' } : x)) }))
    } catch {
      updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === pa.id ? { ...x, status: 'error' } : x)) }))
    }
  }

  function dismissAction(msgId: string, paId: string) {
    updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === paId ? { ...x, status: 'dismissed' } : x)) }))
  }

  // ── Send a message ──
  const historyForApi = (msgs: CoachMsg[]) =>
    msgs.map(m => {
      const notes = (m.actions ?? []).map(pa => {
        const d = describeAction(pa.action, units)
        const verb = pa.status === 'done' ? 'EXECUTED' : pa.status === 'dismissed' ? 'DISMISSED by user' : 'proposed'
        return `[${verb}: ${d.title}${d.detail ? ` — ${d.detail}` : ''}]`
      }).join(' ')
      return { role: m.role, content: m.content + (notes ? `\n${notes}` : '') }
    })

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')
    const userMsg: CoachMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const assistantId = `a-${Date.now()}`
    const history = historyForApi(messages.slice(-12))
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', actions: [] }])
    setStreaming(true)

    try {
      const res = await fetch('/api/gym/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history, currentExId }),
      })
      if (!res.body) throw new Error('no body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          let ev: CoachStreamEvent
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.t === 'text') {
            updateMsg(assistantId, m => ({ ...m, content: m.content + ev.v }))
          } else if (ev.t === 'action') {
            const pa: ProposedAction = { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, action: ev.action, status: 'pending' }
            updateMsg(assistantId, m => ({ ...m, actions: [...(m.actions ?? []), pa] }))
          } else if (ev.t === 'error') {
            updateMsg(assistantId, m => ({ ...m, content: m.content || ev.v }))
          }
        }
      }
    } catch {
      updateMsg(assistantId, m => ({ ...m, content: m.content || 'Coach hit an error. Try again.' }))
    } finally {
      setStreaming(false)
    }
  }

  if (!mounted) return null

  const STARTERS = [
    'How should I train today?',
    "What's my next progression on bench?",
    'Build me a quick full-body day',
  ]

  return createPortal(
    <>
      {/* Floating button */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="gym-coach-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => setOpen(true)}
            className="fixed right-4 z-50 flex items-center justify-center"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
              width: 54, height: 54, borderRadius: 27,
              background: 'linear-gradient(145deg, rgba(74,222,128,0.18), rgba(34,211,238,0.10))',
              border: '1px solid rgba(74,222,128,0.4)',
              boxShadow: '0 6px 24px rgba(74,222,128,0.18), inset 0 0 16px rgba(74,222,128,0.06)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            }}
            aria-label="Open gym coach"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.8 4.6L18.5 9l-3.8 3.1L15.8 17 12 14.3 8.2 17l1.1-4.9L5.5 9l4.7-1.4z" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel + backdrop */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="gym-coach-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-[60]"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            />
            <motion.div
              key="gym-coach-panel"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 360, damping: 36 }}
              className="fixed left-0 right-0 bottom-0 z-[70] flex flex-col"
              style={{
                height: '62vh',
                background: 'linear-gradient(180deg, rgba(10,12,16,0.98), rgba(6,7,10,0.99))',
                borderTop: '1px solid rgba(74,222,128,0.18)',
                borderRadius: '20px 20px 0 0',
                boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
                backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
              }}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-4 pt-3.5 pb-3 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80', boxShadow: '0 0 8px #4ade80' }} />
                    <span className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-zinc-200">Gym Coach</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1 truncate">
                    {focusEx
                      ? <>Viewing <span className="text-zinc-300">{focusEx.name}</span>{focusLast ? ` · last ${focusLast.weight}×${focusLast.reps}` : ''}</>
                      : 'Tactical, in-the-moment coaching'}
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="p-1 -mr-1 text-zinc-500 hover:text-zinc-300" aria-label="Close">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      I can see your splits, recent sets, and recovery. Ask me anything, or tell me to log a set, swap an exercise, or build a workout.
                    </p>
                    <div className="flex flex-col gap-2 w-full max-w-[280px]">
                      {STARTERS.map(s => (
                        <button key={s} onClick={() => send(s)}
                          className="text-[12px] text-zinc-300 px-3 py-2 rounded-xl text-left"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] ${m.role === 'user' ? '' : 'w-full'}`}>
                      {m.content && (
                        <div
                          className="text-[13.5px] leading-relaxed rounded-2xl px-3.5 py-2.5"
                          style={m.role === 'user'
                            ? { background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.2)', color: '#dcfce7' }
                            : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#e4e4e7' }}
                        >
                          {m.role === 'user'
                            ? <span className="whitespace-pre-wrap">{m.content}</span>
                            : <ChatText text={m.content} />}
                        </div>
                      )}
                      {/* Action cards */}
                      {(m.actions ?? []).map(pa => {
                        const d = describeAction(pa.action, units)
                        return (
                          <div key={pa.id} className="mt-2 rounded-2xl px-3.5 py-3"
                            style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.18)' }}>
                            <div className="flex items-center gap-2">
                              <span className="text-[12.5px] font-bold text-zinc-100">{d.title}</span>
                            </div>
                            {d.detail && <p className="text-[11.5px] text-zinc-400 mt-0.5">{d.detail}</p>}
                            {pa.action.kind === 'propose_workout' && (
                              <ul className="mt-1.5 space-y-0.5">
                                {pa.action.exercises.map((ex, i) => (
                                  <li key={i} className="text-[11.5px] text-zinc-300">· {ex.name} <span className="text-zinc-500">{ex.rep_min}–{ex.rep_max}</span></li>
                                ))}
                              </ul>
                            )}
                            <div className="mt-2.5">
                              {pa.status === 'pending' && (
                                <div className="flex gap-2">
                                  <button onClick={() => executeAction(m.id, pa)}
                                    className="flex-1 text-[12px] font-bold py-2 rounded-xl"
                                    style={{ background: '#4ade80', color: '#04210f' }}>{d.confirmLabel}</button>
                                  <button onClick={() => dismissAction(m.id, pa.id)}
                                    className="text-[12px] font-semibold py-2 px-3.5 rounded-xl text-zinc-400"
                                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>Dismiss</button>
                                </div>
                              )}
                              {pa.status === 'done' && <span className="text-[12px] font-bold text-green-400">✓ {d.doneLabel}</span>}
                              {pa.status === 'dismissed' && <span className="text-[12px] text-zinc-600">Dismissed</span>}
                              {pa.status === 'error' && (
                                <button onClick={() => executeAction(m.id, pa)} className="text-[12px] font-semibold text-amber-400">Failed — retry</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {streaming && messages[messages.length - 1]?.content === '' && (messages[messages.length - 1]?.actions?.length ?? 0) === 0 && (
                  <div className="flex justify-start">
                    <div className="flex gap-1 px-3.5 py-3 rounded-2xl" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      {[0, 1, 2].map(i => (
                        <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-zinc-500"
                          animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 px-3 pt-2 pb-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
                <form onSubmit={e => { e.preventDefault(); send(input) }} className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
                    placeholder="Ask anything about your workout"
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-600 px-3.5 py-2.5 rounded-2xl max-h-28"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  />
                  <button type="submit" disabled={!input.trim() || streaming}
                    className="shrink-0 flex items-center justify-center rounded-full disabled:opacity-30"
                    style={{ width: 40, height: 40, background: '#4ade80' }} aria-label="Send">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#04210f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                  </button>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body
  )
}
