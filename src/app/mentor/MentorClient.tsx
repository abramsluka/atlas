'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import {
  useJots,
  useMentorContext,
  useMentorPrompts,
  useWeeklyReports,
  useLatestSynthesis,
} from '@/features/mentor/queries'
import { useCreateJot, useGenerateWeeklyReport, useRunSynthesis } from '@/features/mentor/mutations'
import type { ChatMessage } from '@/features/mentor/types'

// ─── helpers ──────────────────────────────────────────────────────────────────

function inferMode(text: string): 'COACH' | 'REFLECT' | 'PLAN' | null {
  const lower = text.toLowerCase()
  const questionCount = (text.match(/\?/g) || []).length
  const hasSteps = /(\d\.|step |first,|second,|next,|then,|finally,)/.test(lower)
  if (questionCount >= 2) return 'REFLECT'
  if (hasSteps) return 'PLAN'
  if (/you need to|you should|push|honest|direct|the truth|call it/.test(lower)) return 'COACH'
  return null
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function getWeekLabel(weekOf: string): string {
  const d = new Date(weekOf + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function getMostRecentSunday(): string {
  const d = new Date()
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

// ─── useReducedMotion ─────────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// ─── useTypewriter ────────────────────────────────────────────────────────────

function useTypewriter(text: string | null | undefined, speed = 18): string {
  const rm = useReducedMotion()
  const [displayed, setDisplayed] = useState('')
  const animatedRef = useRef(false)

  useEffect(() => {
    if (!text) return
    if (animatedRef.current) return  // only animate once per mount
    animatedRef.current = true

    if (rm) {
      setDisplayed(text)
      return
    }

    let i = 0
    setDisplayed('')
    const id = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(id)
    }, speed)
    return () => clearInterval(id)
  }, [text, rm, speed])

  return displayed
}

// ─── voice recorder hook ──────────────────────────────────────────────────────

function useVoiceInput() {
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mimeRef = useRef('audio/webm')

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      mimeRef.current = mime
      const rec = new MediaRecorder(stream, { mimeType: mime })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    } catch { /* mic denied */ }
  }, [])

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise(resolve => {
      if (timerRef.current) clearInterval(timerRef.current)
      const rec = recorderRef.current
      if (!rec) { resolve(null); return }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current })
        resolve(blob)
      }
      rec.stop()
      rec.stream?.getTracks().forEach(t => t.stop())
      setRecording(false)
    })
  }, [])

  const transcribe = useCallback(async (blob: Blob): Promise<string | null> => {
    setTranscribing(true)
    try {
      const ext = mimeRef.current === 'audio/mp4' ? 'm4a' : 'webm'
      const file = new File([blob], `recording.${ext}`, { type: mimeRef.current })
      const fd = new FormData()
      fd.append('audio', file)
      const res = await fetch('/api/mentor/transcribe', { method: 'POST', body: fd })
      if (!res.ok) return null
      const data = await res.json()
      return data.text ?? null
    } finally {
      setTranscribing(false)
    }
  }, [])

  const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return { recording, transcribing, elapsed, start, stop, transcribe, formatElapsed }
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform() {
  return (
    <div className="flex items-center gap-[3px] h-5">
      {[0, 1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-red-400"
          style={{ animation: `waveBar 0.8s ease-in-out infinite`, animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </div>
  )
}

// ─── StreamingCursor ──────────────────────────────────────────────────────────

function StreamingCursor({ done }: { done: boolean }) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    if (done) {
      setFading(true)
      const t = setTimeout(() => setVisible(false), 300)
      return () => clearTimeout(t)
    }
    const id = setInterval(() => setVisible(v => !v), 500)
    return () => clearInterval(id)
  }, [done])

  if (!visible && done) return null

  return (
    <span
      className="inline-block w-[2px] h-[15px] bg-green-400/70 ml-0.5 align-middle"
      style={{ opacity: visible ? 1 : 0, transition: fading ? 'opacity 300ms' : 'none' }}
    />
  )
}

// ─── StreamingOrb ─────────────────────────────────────────────────────────────

function StreamingOrb() {
  return (
    <div
      className="flex items-center gap-[5px] px-3 py-2"
      style={{ background: 'rgba(74,222,128,0.06)', borderRadius: 20, display: 'inline-flex' }}
    >
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-2 h-2 rounded-full bg-green-600/60"
          style={{ animation: 'orbPulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </div>
  )
}

// ─── GoalChip ─────────────────────────────────────────────────────────────────

function GoalChip({ goal, lastComment, delay }: { goal: string; lastComment: string | null; delay: number }) {
  const rm = useReducedMotion()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <motion.div
      className="relative flex-shrink-0"
      ref={ref}
      initial={rm ? false : { x: -12, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: 'easeOut' }}
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase bg-green-950/60 border border-green-800/40 text-green-400 whitespace-nowrap transition-colors hover:bg-green-900/40"
      >
        GOAL: {goal.length > 18 ? goal.slice(0, 18) + '…' : goal}
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-2 z-50 w-64 rounded-xl p-3 text-xs text-zinc-300 leading-relaxed"
          style={{
            background: 'rgba(10,20,10,0.95)',
            border: '1px solid rgba(74,222,128,0.2)',
            animation: 'goalPopover 150ms ease-out',
          }}
        >
          <p className="font-semibold text-white mb-1">{goal}</p>
          {lastComment && <p className="text-zinc-400 italic">&quot;{lastComment}&quot;</p>}
        </div>
      )}
    </motion.div>
  )
}

// ─── StatusBar ────────────────────────────────────────────────────────────────

interface StatusChip { label: string; value?: string; color?: string }

function StatusBar({
  workoutsThisWeek,
  primaryGoal,
  goalLastComment,
}: {
  workoutsThisWeek: number
  primaryGoal: string | null
  goalLastComment: string | null
}) {
  const rm = useReducedMotion()
  const chips: StatusChip[] = [
    { label: '● LIVE', color: '#4ade80' },
    { label: `WORKOUTS 7D: ${workoutsThisWeek}` },
  ]

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 mb-3" style={{ scrollbarWidth: 'none' }}>
      {chips.map((chip, i) => (
        <motion.div
          key={i}
          initial={rm ? false : { x: -12, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: i * 0.08, duration: 0.25, ease: 'easeOut' }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase whitespace-nowrap flex-shrink-0"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: chip.color ?? 'rgba(255,255,255,0.5)',
          }}
        >
          {chip.label}
        </motion.div>
      ))}
      {primaryGoal && (
        <GoalChip goal={primaryGoal} lastComment={goalLastComment} delay={chips.length * 0.08} />
      )}
    </div>
  )
}

// ─── PromptSkeleton ───────────────────────────────────────────────────────────

function PromptSkeleton() {
  return (
    <div className="flex gap-2 flex-wrap">
      {[80, 120, 100, 90].map((w, i) => (
        <div
          key={i}
          className="h-8 rounded-full animate-pulse"
          style={{ width: w, background: 'rgba(255,255,255,0.06)' }}
        />
      ))}
    </div>
  )
}

// ─── Quick Jot animation ghost ────────────────────────────────────────────────

function useJotFlight() {
  const ghostRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)
  const targetRef = useRef<HTMLDivElement>(null)

  const fly = useCallback((text: string) => {
    const ghost = ghostRef.current
    const source = sourceRef.current
    if (!ghost || !source) return

    const srcRect = source.getBoundingClientRect()

    ghost.textContent = text
    ghost.style.display = 'block'
    ghost.style.left = `${srcRect.left}px`
    ghost.style.top = `${srcRect.top}px`
    ghost.style.width = `${srcRect.width}px`
    ghost.style.opacity = '1'
    ghost.style.transform = ''

    let start: number | null = null
    const duration = 400

    function step(ts: number) {
      if (!start) start = ts
      const t = Math.min((ts - start) / duration, 1)
      const ease = t * t  // ease-in
      ghost!.style.transform = `translateY(${120 * ease}px) scale(${1 - ease * 0.3})`
      ghost!.style.opacity = String(1 - ease)
      if (t < 1) requestAnimationFrame(step)
      else {
        ghost!.style.display = 'none'
        ghost!.style.transform = ''
        ghost!.style.opacity = '0'
      }
    }
    requestAnimationFrame(step)
  }, [])

  return { ghostRef, sourceRef, targetRef, fly }
}

// ─── The Void ─────────────────────────────────────────────────────────────────

function TheVoid({
  targetRef,
  totalCount,
  onCountBounce,
}: {
  targetRef: React.RefObject<HTMLDivElement | null>
  totalCount: number
  onCountBounce: boolean
}) {
  const rm = useReducedMotion()
  const { data: jotsData } = useJots()
  const { data: synthesis } = useLatestSynthesis()
  const runSynthesis = useRunSynthesis()

  const jots = jotsData?.jots ?? []

  const shouldAutoSynthesize = useRef(false)
  useEffect(() => {
    if (jots.length >= 5 && !synthesis && !shouldAutoSynthesize.current) {
      shouldAutoSynthesize.current = true
      runSynthesis.mutate()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jots.length, synthesis])

  return (
    <div className="mt-8 pt-6" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
      {/* Divider label */}
      <div className="flex items-center justify-between mb-6">
        <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-600">
          MEMORY ·{' '}
          <motion.span
            key={totalCount}
            animate={rm ? undefined : { scale: [1, 1.4, 1] }}
            transition={{ type: 'keyframes', duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
            style={{ display: 'inline-block' }}
          >
            {totalCount}
          </motion.span>
          {' '}THOUGHTS
        </span>
        <button
          onClick={() => runSynthesis.mutate()}
          disabled={runSynthesis.isPending}
          className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase text-green-700 hover:text-green-500 transition-colors disabled:opacity-40"
        >
          {runSynthesis.isPending ? (
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-green-600 border-t-transparent animate-spin" />
          ) : (
            <span>✦</span>
          )}
          Synthesize
        </button>
      </div>

      {/* Heading */}
      <motion.h2
        className="text-4xl font-bold italic text-white mb-3"
        initial={rm ? false : { opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        viewport={{ once: true }}
      >
        The void.
      </motion.h2>
      <motion.p
        className="text-sm text-zinc-600 italic text-center mb-8 leading-relaxed max-w-sm mx-auto"
        initial={rm ? false : { opacity: 0 }}
        whileInView={{ opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        viewport={{ once: true }}
      >
        You have about fifty thousand thoughts a day. Most disappear. The ones that matter live here, and the mentor will remember them for you.
      </motion.p>

      {/* Synthesis card */}
      {synthesis && (
        <div
          ref={targetRef as React.RefObject<HTMLDivElement>}
          className="mb-6 rounded-xl p-4"
          style={{ background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid rgba(74,222,128,0.4)' }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-green-600">✦ ATLAS NOTICED</span>
            <span className="text-[10px] text-zinc-600">{relativeTime(synthesis.created_at)}</span>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">{synthesis.synthesis_text}</p>
        </div>
      )}

      {/* Floating particle field */}
      {jots.length > 0 ? (() => {
        const shown = jots.slice(0, 8)
        const overflow = jots.length - shown.length
        return (
          <div className="relative" style={{ minHeight: 280, overflow: 'hidden' }}>
            {shown.map((jot, i) => {
              const left = (i * 37 + 11) % 70
              const top = (i * 53 + 7) % 75
              const duration = 6 + (i % 4)
              return (
                <motion.div
                  key={jot.id}
                  className="absolute group cursor-default"
                  initial={rm ? false : { opacity: 0, y: 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.3 }}
                  viewport={{ once: true }}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    maxWidth: 160,
                    animationName: 'jotFloat',
                    animationDuration: `${duration}s`,
                    animationTimingFunction: 'ease-in-out',
                    animationIterationCount: 'infinite',
                    animationDirection: 'alternate',
                    animationDelay: `${i * 0.4}s`,
                    zIndex: 1,
                  }}
                >
                  <div
                    className="rounded-xl px-3 py-2 backdrop-blur-sm transition-all duration-200 group-hover:scale-105 group-hover:z-10"
                    style={{
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.07)',
                      boxShadow: 'none',
                    }}
                    onMouseEnter={e => {
                      const el = e.currentTarget
                      el.style.border = '1px solid rgba(74,222,128,0.25)'
                      el.style.boxShadow = '0 0 12px rgba(74,222,128,0.08)'
                      el.parentElement!.style.zIndex = '10'
                    }}
                    onMouseLeave={e => {
                      const el = e.currentTarget
                      el.style.border = '1px solid rgba(255,255,255,0.07)'
                      el.style.boxShadow = 'none'
                      el.parentElement!.style.zIndex = '1'
                    }}
                  >
                    <p className="text-[11px] text-zinc-300 leading-snug mb-1 line-clamp-3 group-hover:line-clamp-none">
                      {jot.content}
                    </p>
                    <p className="text-[9px] text-zinc-700">{relativeTime(jot.created_at)}</p>
                  </div>
                </motion.div>
              )
            })}

            {/* Radial edge fade */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.7) 90%, rgba(0,0,0,0.95) 100%)',
              }}
            />

            {overflow > 0 && (
              <div className="absolute bottom-2 left-0 right-0 flex justify-center pointer-events-none">
                <span className="text-[10px] text-zinc-700 tracking-widest">+ {overflow} more</span>
              </div>
            )}
          </div>
        )
      })() : (
        <motion.p
          className="text-[12px] text-zinc-600 italic text-center py-12"
          initial={rm ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          viewport={{ once: true }}
        >
          Nothing yet. The void is patient.
        </motion.p>
      )}

      <div className="pb-32" />
    </div>
  )
}

// ─── Reports Tab ──────────────────────────────────────────────────────────────

function ReportsTab() {
  const { data: reports, isLoading } = useWeeklyReports()
  const generateReport = useGenerateWeeklyReport()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        {[1, 2].map(i => <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />)}
      </div>
    )
  }

  const currentWeekOf = getMostRecentSunday()
  const hasCurrentWeek = reports?.some(r => r.week_of === currentWeekOf)

  function extractSection(text: string, heading: string): string {
    const match = text.match(new RegExp(`\\*\\*${heading}\\*\\*[\\s\\S]*?(?=\\*\\*|$)`, 'i'))
    return match ? match[0].replace(/\*\*[^*]+\*\*/g, '').trim().slice(0, 120) + '…' : ''
  }

  return (
    <div className="mt-4">
      {!hasCurrentWeek && (
        <button
          onClick={() => generateReport.mutate()}
          disabled={generateReport.isPending}
          className="w-full mb-4 py-3 rounded-xl text-sm font-semibold text-black disabled:opacity-50"
          style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
        >
          {generateReport.isPending ? 'Generating report…' : 'Generate this week\'s report'}
        </button>
      )}
      <div className="space-y-3">
        {(reports ?? []).map(report => (
          <div
            key={report.id}
            className="rounded-xl overflow-hidden cursor-pointer"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            onClick={() => setExpanded(expanded === report.id ? null : report.id)}
          >
            <div className="flex items-center justify-between p-4">
              <div>
                <p className="text-[10px] font-bold tracking-widest uppercase text-zinc-500 mb-0.5">
                  WEEK OF {getWeekLabel(report.week_of)}
                </p>
                {expanded !== report.id && (
                  <p className="text-sm text-zinc-400 leading-snug">
                    {extractSection(report.report_text, 'What Went Well')}
                  </p>
                )}
              </div>
              <span className="text-zinc-600 ml-3 flex-shrink-0">{expanded === report.id ? '↑' : '↓'}</span>
            </div>
            {expanded === report.id && (
              <div className="px-4 pb-4 border-t border-white/[0.06]">
                <div className="mt-3 text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                  {report.report_text}
                </div>
              </div>
            )}
          </div>
        ))}
        {(reports ?? []).length === 0 && !generateReport.isPending && (
          <p className="text-sm text-zinc-600 text-center py-8">No reports yet. Generate your first weekly report above.</p>
        )}
      </div>
    </div>
  )
}

// ─── Main MentorClient ────────────────────────────────────────────────────────

export default function MentorClient() {
  const instanceId = useId()
  const rm = useReducedMotion()
  const queryClient = useQueryClient()

  const [tab, setTab] = useState<'chat' | 'reports'>('chat')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [jotInput, setJotInput] = useState('')
  const [jotBounce, setJotBounce] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const [workoutsThisWeek, setWorkoutsThisWeek] = useState(0)
  const [flightPill, setFlightPill] = useState<number | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const promptPillsRef = useRef<HTMLDivElement>(null)

  const { data: mentorCtx } = useMentorContext()
  const { data: promptsData, isLoading: promptsLoading } = useMentorPrompts()
  const { data: synthesis, isLoading: synthesisLoading } = useLatestSynthesis()
  const createJot = useCreateJot()
  const voice = useVoiceInput()

  const { ghostRef, sourceRef, targetRef, fly } = useJotFlight()

  // Typewriter for proactive Atlas message
  const synthesisText = synthesis?.synthesis_text ?? null
  const typewriterText = useTypewriter(synthesisText, 18)

  // Fetch workouts this week for status bar
  useEffect(() => {
    fetch('/api/home/activity-snapshot')
      .then(r => r.json())
      .then(d => setWorkoutsThisWeek(d?.gym ?? 0))
      .catch(() => {})
  }, [])

  const { data: jotsData } = useJots()
  const totalJots = jotsData?.total_count ?? 0

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Invalidate context after messages (to pick up profile updates)
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].role === 'assistant') {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['mentor-context'] }), 3000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    const assistantId = `a-${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/mentor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text.trim(), history }),
      })

      if (!res.ok || !res.body) {
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: 'Something went wrong. Try again.' } : m))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + chunk } : m))
      }
    } finally {
      setStreaming(false)
    }
  }, [streaming, messages])

  const handlePromptClick = useCallback((prompt: string) => {
    setInput(prompt)
    setTimeout(() => sendMessage(prompt), 200)
  }, [sendMessage])

  const handlePillClick = useCallback((p: string, i: number) => {
    if (rm) { handlePromptClick(p); return }
    setFlightPill(i)
    setTimeout(() => {
      setFlightPill(null)
      handlePromptClick(p)
    }, 200)
  }, [rm, handlePromptClick])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const handleVoiceMic = async () => {
    if (voice.recording) {
      const blob = await voice.stop()
      if (!blob) return
      const text = await voice.transcribe(blob)
      if (text) {
        setInput(text)
        setVoiceMode(false)
        setTimeout(() => sendMessage(text), 400)
      } else {
        setVoiceMode(false)
      }
    } else {
      setVoiceMode(true)
      voice.start()
    }
  }

  const handleJotSave = () => {
    const content = jotInput.trim()
    if (!content) return
    fly(content)
    createJot.mutate(content, {
      onSuccess: () => {
        setJotBounce(true)
        setTimeout(() => setJotBounce(false), 200)
      },
    })
    setJotInput('')
  }

  return (
    <>
      {/* Jot flight ghost */}
      <div
        ref={ghostRef}
        style={{
          position: 'fixed',
          display: 'none',
          pointerEvents: 'none',
          zIndex: 100,
          fontSize: 12,
          color: 'rgba(255,255,255,0.6)',
          padding: '4px 8px',
          background: 'rgba(10,20,10,0.8)',
          borderRadius: 8,
          border: '1px solid rgba(74,222,128,0.3)',
        }}
      />

      <main className="nebula-mentor min-h-screen px-4 pt-14 pb-24">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4 mb-4">
          {/* Left: title */}
          <div>
            <h1 className="text-4xl font-bold italic text-white leading-tight">Mentor</h1>
            <p className="text-xs text-zinc-600 mt-0.5">what&apos;s on your mind, Luka?</p>
          </div>

          {/* Right: Quick Jot */}
          <div
            ref={sourceRef}
            className="flex-shrink-0 w-52 rounded-xl p-3"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="text-[9px] font-bold tracking-[0.2em] uppercase text-zinc-600 mb-2">QUICK JOT</p>
            <textarea
              value={jotInput}
              onChange={e => setJotInput(e.target.value)}
              placeholder="idea · reminder · goal..."
              rows={2}
              className="w-full resize-none bg-transparent text-xs text-white placeholder:text-zinc-700 outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => {
                  const content = `goal: ${jotInput.trim()}`
                  if (!jotInput.trim()) return
                  fly(jotInput.trim())
                  createJot.mutate(content)
                  setJotInput('')
                }}
                className="text-[9px] font-bold tracking-wider text-green-700 hover:text-green-500 transition-colors"
              >
                + goal
              </button>
              <button
                onClick={handleJotSave}
                disabled={!jotInput.trim() || createJot.isPending}
                className="w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-30 transition-colors"
                style={{ background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.4)' }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <StatusBar
          workoutsThisWeek={workoutsThisWeek}
          primaryGoal={mentorCtx?.primary_goal ?? null}
          goalLastComment={mentorCtx?.goal_last_comment ?? null}
        />

        {/* Proactive Atlas message */}
        <div className="mb-4 min-h-[28px]">
          {synthesisLoading ? (
            <div
              className="h-3 rounded animate-pulse"
              style={{ width: '65%', background: 'rgba(255,255,255,0.06)' }}
            />
          ) : synthesis ? (
            <div
              className="rounded-xl px-4 py-3"
              style={{
                background: 'rgba(74,222,128,0.03)',
                borderLeft: '2px solid rgba(74,222,128,0.25)',
              }}
            >
              <span className="text-[9px] font-bold tracking-[0.2em] uppercase text-green-800 block mb-1">✦ ATLAS NOTICED</span>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                {typewriterText}
                {typewriterText.length > 0 && typewriterText.length < (synthesisText?.length ?? 0) && (
                  <span className="inline-block w-[1px] h-[11px] bg-green-700/60 ml-0.5 align-middle animate-pulse" />
                )}
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-600 italic">
              I can see your profile, workouts, water, weights, wearable, and notes.
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {(['chat', 'reports'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 text-xs font-bold tracking-widest uppercase transition-colors ${tab === t ? 'text-white border-b border-white -mb-px' : 'text-zinc-600'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'reports' && <ReportsTab />}

        {tab === 'chat' && (
          <>
            {/* Suggested prompts */}
            <div ref={promptPillsRef} className="mb-4">
              {promptsLoading ? (
                <PromptSkeleton />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(promptsData?.prompts ?? []).map((p, i) => (
                    <motion.button
                      key={`${instanceId}-${i}`}
                      onClick={() => handlePillClick(p, i)}
                      disabled={streaming}
                      whileTap={rm ? undefined : { scale: 0.95 }}
                      animate={flightPill === i ? { y: 40, opacity: 0 } : { y: 0, opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      className="px-3 py-1.5 rounded-full text-xs text-zinc-400 border border-zinc-800 disabled:opacity-40 transition-[border-color,box-shadow]"
                      style={{
                        background: 'rgba(255,255,255,0.02)',
                        animationFillMode: 'both',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.boxShadow = '0 0 12px rgba(74,222,128,0.25)'
                        e.currentTarget.style.borderColor = 'rgba(74,222,128,0.3)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.boxShadow = 'none'
                        e.currentTarget.style.borderColor = ''
                      }}
                    >
                      {p}
                    </motion.button>
                  ))}
                </div>
              )}
            </div>

            {/* Messages */}
            {messages.length > 0 && (
              <div className="space-y-4 mb-4">
                <AnimatePresence initial={false}>
                  {messages.map((msg, i) => {
                    const isLast = i === messages.length - 1
                    const isStreaming = isLast && streaming && msg.role === 'assistant'
                    const mode = !isStreaming && msg.role === 'assistant' && msg.content ? inferMode(msg.content) : null

                    return (
                      <motion.div
                        key={msg.id}
                        initial={rm ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="max-w-[85%]">
                          {msg.role === 'user' ? (
                            <div
                              className="rounded-2xl px-4 py-2.5 text-sm text-white leading-relaxed"
                              style={{ background: 'rgba(255,255,255,0.08)' }}
                            >
                              {msg.content}
                            </div>
                          ) : (
                            <>
                              {msg.content === '' && isStreaming ? (
                                <StreamingOrb />
                              ) : (
                                <div
                                  className="text-sm text-zinc-200 leading-relaxed"
                                  style={{
                                    borderRadius: 16,
                                    padding: '12px 16px',
                                    background: 'rgba(74,222,128,0.04)',
                                    border: '1px solid rgba(74,222,128,0.12)',
                                    backdropFilter: 'blur(8px)',
                                    WebkitBackdropFilter: 'blur(8px)',
                                    borderLeft: '2px solid rgba(74,222,128,0.25)',
                                  }}
                                >
                                  <span className="whitespace-pre-wrap">{msg.content}</span>
                                  {isStreaming && <StreamingCursor done={false} />}
                                  {!isStreaming && isLast && <StreamingCursor done={true} />}
                                </div>
                              )}
                              {mode && (
                                <div
                                  className="mt-1 ml-1 text-[10px] tracking-widest uppercase text-green-800/70"
                                  style={{ animation: 'promptFadeIn 200ms ease forwards' }}
                                >
                                  · {mode.toLowerCase()} ·
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Chat input */}
            <div
              className="rounded-2xl overflow-hidden"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: voice.recording
                  ? '1px solid rgba(248,113,113,0.5)'
                  : '1px solid rgba(255,255,255,0.08)',
                boxShadow: voice.recording ? '0 0 0 2px rgba(248,113,113,0.15)' : 'none',
                transition: 'border-color 200ms, box-shadow 200ms',
              }}
            >
              {voice.recording || voice.transcribing ? (
                <div className="flex items-center gap-3 px-4 py-3">
                  {voice.recording ? <Waveform /> : (
                    <span className="inline-block w-4 h-4 rounded-full border border-zinc-400 border-t-transparent animate-spin" />
                  )}
                  <span className="text-sm text-zinc-400">
                    {voice.recording ? voice.formatElapsed(voice.elapsed) : 'Transcribing…'}
                  </span>
                </div>
              ) : (
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="ask me anything, Luka..."
                  rows={1}
                  disabled={streaming}
                  className="w-full resize-none bg-transparent px-4 py-3 pr-20 text-sm text-white placeholder:text-zinc-700 outline-none leading-relaxed disabled:opacity-50"
                  style={{ minHeight: 48 }}
                />
              )}

              <div className="flex items-center justify-between px-3 pb-2">
                {/* Mic button */}
                <button
                  onClick={handleVoiceMic}
                  disabled={voice.transcribing}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                  style={{
                    background: voice.recording ? 'rgba(248,113,113,0.2)' : 'rgba(255,255,255,0.06)',
                    border: voice.recording ? '1px solid rgba(248,113,113,0.5)' : '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke={voice.recording ? '#f87171' : '#71717a'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                </button>

                {/* Send button */}
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || streaming}
                  className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-30 transition-opacity"
                  style={{ background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.4)' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>

            {/* The Void */}
            <TheVoid
              targetRef={targetRef}
              totalCount={totalJots}
              onCountBounce={jotBounce}
            />
          </>
        )}
      </main>

      <style>{`
        @keyframes jotFloat {
          from { transform: translateY(0px) rotate(0deg); }
          to { transform: translateY(-12px) rotate(0.5deg); }
        }
        @keyframes waveBar {
          0%, 100% { height: 6px; }
          50% { height: 18px; }
        }
        @keyframes orbPulse {
          0%, 100% { opacity: 0.4; transform: scale(1); box-shadow: none; }
          50% { opacity: 1; transform: scale(1.3); box-shadow: 0 0 6px rgba(74,222,128,0.6); }
        }
        @keyframes promptFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes goalPopover {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .scrollbar-none::-webkit-scrollbar { display: none; }
      `}</style>
    </>
  )
}
