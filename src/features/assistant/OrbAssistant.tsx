'use client'

// The Atlas Orb — global quick-capture assistant. A floating globe FAB on every
// page (except /login and /mentor) that opens a bottom sheet: speak or type,
// Claude proposes actions as confirm cards, confirmed cards execute through the
// same TanStack mutations the manual UIs use. One thread, shared across pages
// (single localStorage key). Generalized from the old GymChatbot.

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import ChatText from '@/components/ChatText'
import { usePersistentChat } from '@/lib/usePersistentChat'
import { useVoiceRecorder, formatElapsed } from '@/features/journal/useVoiceRecorder'
import { describeAction, type AssistantStreamEvent, type ProposedAction } from './actions'
import { useAssistantActions } from './useAssistantActions'
import ActionCard from './ActionCard'

interface OrbMsg {
  id: string
  role: 'user' | 'assistant'
  content: string
  actions?: ProposedAction[]
  clarify?: { question: string; options: string[] } | null
}

const HIDDEN_ON = ['/login', '/mentor']

export default function OrbAssistant() {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = usePersistentChat<OrbMsg>('atlas-orb-thread-v1', 40)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [micNote, setMicNote] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // What to do with the transcript once the recording stops:
  // 'send' → straight into the chat; 'fill' → into the input box for editing.
  const micIntent = useRef<'send' | 'fill' | null>(null)

  const { executeAction, units } = useAssistantActions()
  const rec = useVoiceRecorder()

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, open, streaming, transcribing])

  const updateMsg = useCallback((id: string, fn: (m: OrbMsg) => OrbMsg) =>
    setMessages(prev => prev.map(m => (m.id === id ? fn(m) : m))), [setMessages])

  // ── History with action outcomes, so the model knows what happened ──
  const historyForApi = (msgs: OrbMsg[]) =>
    msgs.map(m => {
      const notes = (m.actions ?? []).map(pa => {
        const d = describeAction(pa.action, units)
        const verb = pa.status === 'done' ? 'EXECUTED' : pa.status === 'dismissed' ? 'DISMISSED by user' : 'proposed'
        return `[${verb}: ${d.title}${d.detail ? ` — ${d.detail}` : ''}]`
      }).join(' ')
      return { role: m.role, content: m.content + (notes ? `\n${notes}` : '') }
    })

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setInput('')
    setMicNote(null)
    const userMsg: OrbMsg = { id: `u-${Date.now()}`, role: 'user', content: trimmed }
    const assistantId = `a-${Date.now()}`
    const history = historyForApi(messages.slice(-12))
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', actions: [], clarify: null }])
    setStreaming(true)

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, history, page: pathname }),
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
          let ev: AssistantStreamEvent
          try { ev = JSON.parse(line) } catch { continue }
          if (ev.t === 'text') {
            updateMsg(assistantId, m => ({ ...m, content: m.content + ev.v }))
          } else if (ev.t === 'action') {
            const pa: ProposedAction = { id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, action: ev.action, status: 'pending' }
            updateMsg(assistantId, m => ({ ...m, actions: [...(m.actions ?? []), pa] }))
          } else if (ev.t === 'clarify') {
            updateMsg(assistantId, m => ({ ...m, clarify: { question: ev.question, options: ev.options } }))
          } else if (ev.t === 'error') {
            updateMsg(assistantId, m => ({ ...m, content: m.content || ev.v }))
          }
        }
      }
    } catch {
      updateMsg(assistantId, m => ({ ...m, content: m.content || 'Atlas hit an error. Try again.' }))
    } finally {
      setStreaming(false)
    }
  }, [messages, streaming, pathname, units, setMessages, updateMsg]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voice: record → transcribe → send or fill the input, per intent ──
  useEffect(() => {
    if (!rec.blob || !micIntent.current) return
    const intent = micIntent.current
    micIntent.current = null
    const file = rec.toFile()
    rec.reset()
    if (!file) return
    ;(async () => {
      setTranscribing(true)
      try {
        const fd = new FormData()
        fd.append('audio', file)
        const res = await fetch('/api/assistant/transcribe', { method: 'POST', body: fd })
        const json = await res.json().catch(() => ({}))
        const text = typeof json.text === 'string' ? json.text.trim() : ''
        if (!res.ok || !text) {
          setMicNote("Didn't hear anything — try again.")
          return
        }
        if (intent === 'send') await send(text)
        else setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text))
      } catch {
        setMicNote('Transcription failed — try again.')
      } finally {
        setTranscribing(false)
      }
    })()
  }, [rec.blob]) // eslint-disable-line react-hooks/exhaustive-deps

  const startMic = () => {
    setMicNote(null)
    rec.start()
  }
  const stopMic = (intent: 'send' | 'fill') => {
    micIntent.current = intent
    rec.stop()
  }

  // Tapping the FAB opens the sheet already recording (voice-first).
  const openSheet = () => {
    setOpen(true)
    startMic()
  }
  // Closing while recording cancels it — mic off, nothing transcribed or sent.
  const closeSheet = () => {
    if (rec.recording) {
      micIntent.current = null
      rec.stop()
      rec.reset()
    }
    setOpen(false)
  }

  // ── Confirm / dismiss ──
  const runAction = async (msgId: string, pa: ProposedAction) => {
    setBusyActionId(pa.id)
    try {
      await executeAction(pa.action)
      updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === pa.id ? { ...x, status: 'done' } : x)) }))
      if (pa.action.kind === 'generate_program') setOpen(false)
    } catch {
      updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === pa.id ? { ...x, status: 'error' } : x)) }))
    } finally {
      setBusyActionId(null)
    }
  }

  const dismissAction = (msgId: string, paId: string) =>
    updateMsg(msgId, m => ({ ...m, actions: m.actions?.map(x => (x.id === paId ? { ...x, status: 'dismissed' } : x)) }))

  const confirmAll = async (msgId: string, pending: ProposedAction[]) => {
    for (const pa of pending) await runAction(msgId, pa)
  }

  if (!mounted) return null
  if (HIDDEN_ON.some(p => pathname.startsWith(p))) return null

  const lastMsg = messages[messages.length - 1]
  const clarify = !streaming && lastMsg?.role === 'assistant' ? lastMsg.clarify : null

  const HINTS = [
    'Did bench, 8 reps at 135',
    'Took my magnesium and multivitamin',
    'Weight is 176, had 20 oz of water',
  ]

  return createPortal(
    <>
      {/* Floating orb */}
      <AnimatePresence>
        {!open && (
          <motion.button
            key="atlas-orb-fab"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={openSheet}
            className="fixed right-4 z-50 flex items-center justify-center"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 72px)',
              width: 54, height: 54, borderRadius: 27,
              background: 'linear-gradient(145deg, rgba(74,222,128,0.18), rgba(34,211,238,0.10))',
              border: '1px solid rgba(74,222,128,0.4)',
              boxShadow: '0 6px 22px rgba(74,222,128,0.2), 0 0 8px rgba(74,222,128,0.1), inset 0 0 16px rgba(74,222,128,0.06)',
              backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
            }}
            aria-label="Open Atlas assistant"
          >
            {/* The Orb — PWA globe mark, subtle glow (static, no pulse) */}
            <svg
              width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round"
              style={{ filter: 'drop-shadow(0 0 3px rgba(74,222,128,0.5))' }}
            >
              <circle cx="12" cy="12" r="9" />
              <ellipse cx="12" cy="12" rx="4.2" ry="9" />
              <ellipse cx="12" cy="12" rx="9" ry="3.6" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Sheet + backdrop */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="atlas-orb-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeSheet}
              className="fixed inset-0 z-[60]"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            />
            <motion.div
              key="atlas-orb-panel"
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
                    <span className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-zinc-200">Atlas</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-1 truncate">Say it, confirm it, logged.</p>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      onClick={() => setMessages([])}
                      className="text-[10.5px] uppercase tracking-wider px-2 py-1 text-zinc-600 hover:text-zinc-400"
                      aria-label="Clear thread"
                    >
                      Clear
                    </button>
                  )}
                  <button onClick={closeSheet} className="p-1 -mr-1 text-zinc-500 hover:text-zinc-300" aria-label="Close">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
                    <p className="text-sm text-zinc-400 leading-relaxed">
                      Tell me what happened and I&apos;ll log it — sets, supplements, weight, water, caffeine, notes. I can also manage your gym setup from anywhere.
                    </p>
                    <div className="flex flex-col gap-2 w-full max-w-[280px]">
                      {HINTS.map(s => (
                        <button key={s} onClick={() => send(s)}
                          className="text-[12px] text-zinc-300 px-3 py-2 rounded-xl text-left"
                          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
                          &ldquo;{s}&rdquo;
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map(m => {
                  const pending = (m.actions ?? []).filter(a => a.status === 'pending')
                  return (
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
                        {(m.actions ?? []).map(pa => (
                          <ActionCard
                            key={pa.id}
                            pa={pa}
                            units={units}
                            busy={busyActionId === pa.id}
                            onConfirm={() => runAction(m.id, pa)}
                            onDismiss={() => dismissAction(m.id, pa.id)}
                          />
                        ))}
                        {pending.length >= 2 && (
                          <button
                            onClick={() => confirmAll(m.id, pending)}
                            disabled={busyActionId != null}
                            className="mt-2 w-full text-[12.5px] font-bold px-3.5 py-2.5 rounded-2xl disabled:opacity-50"
                            style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.35)', color: '#bbf7d0' }}
                          >
                            Confirm all ({pending.length})
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Thinking dots — streaming only; transcribing lives in the input box */}
                {streaming && (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content) && (
                  <div className="flex items-center gap-1.5 px-1">
                    {[0, 1, 2].map(i => (
                      <motion.span key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }}
                        animate={{ opacity: [0.25, 1, 0.25] }}
                        transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.18 }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Clarify chips */}
              {clarify && clarify.options.length > 0 && (
                <div className="px-4 pb-2 flex flex-wrap gap-2 shrink-0">
                  {clarify.options.map(opt => (
                    <button key={opt} onClick={() => send(opt)}
                      className="text-[12px] text-zinc-200 px-3 py-1.5 rounded-full"
                      style={{ background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.3)' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {micNote && <p className="px-4 pb-1 text-[11px] text-amber-400/90 shrink-0">{micNote}</p>}
              {rec.error && <p className="px-4 pb-1 text-[11px] text-amber-400/90 shrink-0">{rec.error}</p>}

              {/* Input row */}
              <div className="px-3 pb-3 pt-1 shrink-0" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
                <div className="flex items-end gap-2 rounded-2xl px-3 py-2"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}>
                  {rec.recording ? (
                    <>
                      {/* Stop (left): end recording, transcribe into the input box — no send */}
                      <button
                        onClick={() => stopMic('fill')}
                        className="p-2 rounded-full shrink-0"
                        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.16)' }}
                        aria-label="Stop — keep transcript in the input box"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="#e4e4e7"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                      </button>
                      <div className="flex-1 flex items-center justify-center gap-2 py-1.5 min-w-0">
                        <motion.span className="w-2 h-2 rounded-full shrink-0" style={{ background: '#f87171' }}
                          animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} />
                        <span className="text-[13px] text-zinc-300 truncate">Listening… {formatElapsed(rec.elapsed)}</span>
                      </div>
                      {/* Send (right): end recording, transcribe, and send immediately */}
                      <button
                        onClick={() => stopMic('send')}
                        className="p-2 rounded-full shrink-0"
                        style={{ background: 'rgba(74,222,128,0.18)', border: '1px solid rgba(74,222,128,0.45)' }}
                        aria-label="Stop and send"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </>
                  ) : transcribing ? (
                    <>
                      {/* ChatGPT-style: spinner + label inline in the input box */}
                      <div className="flex-1 flex items-center gap-2 py-1.5">
                        <svg className="animate-spin shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M12 3a9 9 0 1 1-9 9" />
                        </svg>
                        <span className="text-[13.5px] text-zinc-500 animate-pulse">Transcribing</span>
                      </div>
                      <button disabled className="p-2 rounded-full opacity-40"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.3)' }} aria-label="Send">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
                        }}
                        placeholder="Log anything…"
                        rows={1}
                        className="flex-1 bg-transparent resize-none outline-none text-[13.5px] text-zinc-100 placeholder-zinc-600 py-1.5 max-h-24"
                      />
                      <button
                        onClick={startMic}
                        disabled={transcribing || streaming}
                        className="p-2 rounded-full disabled:opacity-40"
                        style={{ background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.25)' }}
                        aria-label="Record voice"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round">
                          <rect x="9" y="3" width="6" height="11" rx="3" />
                          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                        </svg>
                      </button>
                      <button
                        onClick={() => send(input)}
                        disabled={!input.trim() || streaming}
                        className="p-2 rounded-full disabled:opacity-40"
                        style={{ background: 'rgba(74,222,128,0.14)', border: '1px solid rgba(74,222,128,0.3)' }}
                        aria-label="Send"
                      >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>,
    document.body,
  )
}
