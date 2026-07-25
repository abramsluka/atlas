'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { useJournalEntry } from '@/features/journal/queries'
import { useUpdateEntry, useDeleteEntry } from '@/features/journal/mutations'
import type { EntryKind, JournalEntry, PlanItem } from '@/features/journal/types'
import { useVoiceRecorder, formatElapsed } from '@/features/journal/useVoiceRecorder'
import { uploadAudioToStorage } from '@/features/journal/uploadAudio'
import { checkNoApiKey, NoApiKeyClientError, type KeyProvider } from '@/lib/apiKeyError'
import ChatText from '@/components/ChatText'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'

interface Props {
  initialEntry: JournalEntry
}

const MOOD_EMOJIS: Record<number, string> = {
  1: '😔',
  2: '😕',
  3: '😐',
  4: '🙂',
  5: '😄',
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

export default function EntryDetail({ initialEntry }: Props) {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    queryClient.setQueryData(['journal', initialEntry.id], initialEntry)
  }, [queryClient, initialEntry])

  const { data } = useJournalEntry(initialEntry.id)
  const entry = data ?? initialEntry

  const updateEntry = useUpdateEntry()
  const deleteEntry = useDeleteEntry()

  const [editTitle, setEditTitle] = useState(entry.title ?? '')
  const [editBody, setEditBody] = useState(entry.body)
  const [editMood, setEditMood] = useState<number | null>(entry.mood)
  const [kind, setKind] = useState<EntryKind>(entry.kind ?? 'night')

  const [reflectionText, setReflectionText] = useState(entry.ai_reflection ?? '')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [streamKeyProvider, setStreamKeyProvider] = useState<KeyProvider | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [conversation, setConversation] = useState(entry.conversation ?? [])
  const [replyText, setReplyText] = useState('')
  const [isReplying, setIsReplying] = useState(false)
  const [streamingReply, setStreamingReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyKeyProvider, setReplyKeyProvider] = useState<KeyProvider | null>(null)

  const [plan, setPlan] = useState<PlanItem[]>(entry.plan ?? [])
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planKeyProvider, setPlanKeyProvider] = useState<KeyProvider | null>(null)
  const [refineText, setRefineText] = useState('')
  const [focusItemId, setFocusItemId] = useState<string | null>(null)

  const [transcript, setTranscript] = useState(entry.audio_transcript)
  const [showTranscript, setShowTranscript] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeError, setTranscribeError] = useState<string | null>(null)
  const [transcribeKeyProvider, setTranscribeKeyProvider] = useState<KeyProvider | null>(null)
  const rec = useVoiceRecorder()

  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const planSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isMorning = kind === 'morning'

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function scheduleAutoSave(title: string, body: string, mood: number | null) {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      if (!body.trim() && !entry.audio_path && !isMorning) return
      updateEntry.mutate({
        id: entry.id,
        title: title.trim() || undefined,
        body: body.trim(),
        mood,
      })
    }, 1000)
  }

  // ─── Plan (morning) ────────────────────────────────────────────────────────

  function setPlanAndSave(next: PlanItem[]) {
    setPlan(next)
    if (planSaveTimer.current) clearTimeout(planSaveTimer.current)
    planSaveTimer.current = setTimeout(() => {
      // Blank rows stay local (mid-edit) but never persist
      updateEntry.mutate({ id: entry.id, plan: next.filter(p => p.text.trim()) })
    }, 1000)
  }

  function togglePlanItem(id: string) {
    setPlanAndSave(plan.map(p => (p.id === id ? { ...p, done: !p.done } : p)))
  }

  function editPlanItem(id: string, text: string) {
    setPlanAndSave(plan.map(p => (p.id === id ? { ...p, text } : p)))
  }

  function deletePlanItem(id: string) {
    setPlanAndSave(plan.filter(p => p.id !== id))
  }

  function addPlanItem(afterId?: string) {
    const item: PlanItem = { id: crypto.randomUUID(), text: '', done: false }
    if (afterId) {
      const idx = plan.findIndex(p => p.id === afterId)
      const next = [...plan]
      next.splice(idx + 1, 0, item)
      setPlanAndSave(next)
    } else {
      setPlanAndSave([...plan, item])
    }
    setFocusItemId(item.id)
  }

  async function requestPlan(payload?: { message?: string; audioPath?: string }) {
    setPlanning(true)
    setPlanError(null)
    setPlanKeyProvider(null)
    try {
      const res = await fetch(`/api/journal/${entry.id}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      if (!res.ok) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Failed to build plan')
      }
      const json = await res.json()
      setPlan(json.plan)
      queryClient.invalidateQueries({ queryKey: ['journal', entry.id] })
      queryClient.invalidateQueries({ queryKey: ['journal'] })
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setPlanKeyProvider(err.provider)
      else setPlanError(err instanceof Error ? err.message : String(err))
    } finally {
      setPlanning(false)
    }
  }

  async function handleTextRefine() {
    const msg = refineText.trim()
    if (!msg || planning) return
    setRefineText('')
    await requestPlan({ message: msg })
  }

  async function handleVoiceRefine() {
    const file = rec.toFile()
    if (!file || planning) return
    setPlanning(true)
    setPlanError(null)
    try {
      const audioPath = await uploadAudioToStorage(entry.id, file, { reply: true })
      rec.reset()
      setPlanning(false)
      await requestPlan({ audioPath })
    } catch (err) {
      setPlanError(String(err))
      setPlanning(false)
    }
  }

  // ─── Mode toggle ───────────────────────────────────────────────────────────

  function toggleKind() {
    const next: EntryKind = isMorning ? 'night' : 'morning'
    setKind(next)
    updateEntry.mutate({ id: entry.id, kind: next })
  }

  async function handleSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    if (planSaveTimer.current) clearTimeout(planSaveTimer.current)
    await updateEntry.mutateAsync({
      id: entry.id,
      title: editTitle.trim() || undefined,
      body: editBody.trim(),
      mood: editMood,
      ...(isMorning ? { plan: plan.filter(p => p.text.trim()) } : {}),
    })
    router.back()
  }

  async function handleGetReflection() {
    setStreaming(true)
    setStreamError(null)
    setStreamKeyProvider(null)
    setReflectionText('')

    try {
      const res = await fetch(`/api/journal/${entry.id}/reflect`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        const text = await res.text()
        throw new Error(text || 'Failed to get reflection')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setReflectionText((prev) => prev + decoder.decode(value, { stream: true }))      }

      queryClient.invalidateQueries({ queryKey: ['journal', entry.id] })
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setStreamKeyProvider(err.provider)
      else setStreamError(err instanceof Error ? err.message : String(err))
    } finally {
      setStreaming(false)
    }
  }

  async function handleDelete() {
    await deleteEntry.mutateAsync(entry.id)
    router.replace('/journal')
  }

  async function handleTranscribe() {
    setTranscribing(true)
    setTranscribeError(null)
    setTranscribeKeyProvider(null)
    try {
      const res = await fetch(`/api/journal/${entry.id}/transcribe`, { method: 'POST' })
      if (!res.ok) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'Transcription failed')
      }
      const json = await res.json()
      setTranscript(json.transcript)
      setShowTranscript(true)
      queryClient.invalidateQueries({ queryKey: ['journal', entry.id] })
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setTranscribeKeyProvider(err.provider)
      else setTranscribeError(err instanceof Error ? err.message : String(err))
    } finally {
      setTranscribing(false)
    }
  }

  async function refreshConversation() {
    try {
      const res = await fetch(`/api/journal/${entry.id}`)
      if (!res.ok) return
      const fresh: JournalEntry = await res.json()
      setConversation(fresh.conversation ?? [])
      queryClient.setQueryData(['journal', entry.id], fresh)
    } catch { /* keep local state */ }
  }

  async function handleVoiceReply() {
    const file = rec.toFile()
    if (!file || isReplying) return
    setIsReplying(true)
    setStreamingReply('')
    setReplyError(null)
    setReplyKeyProvider(null)

    try {
      // Upload the audio straight to storage first (no Vercel 4.5 MB body limit),
      // then hand the reply route just the path.
      const audioPath = await uploadAudioToStorage(entry.id, file, { reply: true })
      const res = await fetch(`/api/journal/${entry.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioPath }),
      })
      if (!res.ok || !res.body) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        throw new Error(await res.text() || 'Failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setStreamingReply(prev => prev + decoder.decode(value, { stream: true }))      }

      setStreamingReply('')
      rec.reset()
      // Server holds the transcript + signed audio URL for the new messages
      await refreshConversation()
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setReplyKeyProvider(err.provider)
      else setReplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsReplying(false)
    }
  }

  async function handleReply() {
    const userMsg = replyText.trim()
    if (!userMsg || isReplying) return
    setIsReplying(true)
    setReplyText('')
    setStreamingReply('')
    setReplyError(null)
    setReplyKeyProvider(null)

    try {
      const res = await fetch(`/api/journal/${entry.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })
      if (!res.ok || !res.body) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        throw new Error(await res.text() || 'Failed')
      }

      let assistantText = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        assistantText += chunk
        setStreamingReply(prev => prev + chunk)      }

      setStreamingReply('')
      setConversation(prev => [
        ...prev,
        { role: 'user' as const, content: userMsg },
        { role: 'assistant' as const, content: assistantText },
      ])
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setReplyKeyProvider(err.provider)
      else setReplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsReplying(false)
    }
  }

  async function handleGoLonger(messageIndex: number) {
    if (isReplying) return
    setIsReplying(true)
    setStreamingReply('')
    setReplyError(null)
    setReplyKeyProvider(null)

    try {
      const res = await fetch(`/api/journal/${entry.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ makeLonger: true, messageIndex }),
      })
      if (!res.ok || !res.body) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        throw new Error(await res.text() || 'Failed')
      }

      let expandedText = ''
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        expandedText += chunk
        setStreamingReply(prev => prev + chunk)      }

      setStreamingReply('')
      if (messageIndex === -1) {
        setReflectionText(expandedText)
      } else {
        setConversation(prev => prev.map((m, i) =>
          i === messageIndex ? { ...m, content: expandedText } : m
        ))
      }
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setReplyKeyProvider(err.provider)
      else setReplyError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsReplying(false)
    }
  }

  const dateLabel = format(new Date(entry.date + 'T12:00:00'), 'EEE, MMM d')
  const savedReflection = entry.ai_reflection
  const displayReflection = reflectionText || savedReflection

  // Morning: can generate a plan when there's source material to plan from
  const canPlanFromEntry = !!entry.audio_path || !!editBody.trim() || !!entry.body?.trim()
  const hasPlanItems = plan.length > 0
  const canSaveEntry = isMorning
    ? (hasPlanItems || !!entry.audio_path || !!editBody.trim()) && !updateEntry.isPending
    : !updateEntry.isPending && (!!editBody.trim() || !!entry.audio_path)

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div
        className="fixed left-0 right-0 top-0 z-10"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          background: 'rgba(0,0,0,0.85)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => router.back()}
            className="px-1 py-2 text-sm text-zinc-400 active:text-zinc-200"
          >
            ← Back
          </button>

          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-500">{dateLabel}</span>
            <button
              onClick={toggleKind}
              className="flex h-7 w-7 items-center justify-center rounded-full text-sm active:opacity-70 transition-colors"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }}
              title={isMorning ? 'Morning — tap to switch to night' : 'Night — tap to switch to morning'}
            >
              {isMorning ? '☀️' : '🌙'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 text-zinc-600 active:text-zinc-400"
            >
              <TrashIcon />
            </button>
            <button
              onClick={handleSave}
              disabled={!canSaveEntry}
              className="px-1 py-2 text-sm font-semibold text-white disabled:text-zinc-600 active:opacity-70"
            >
              {updateEntry.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 pb-40 pt-4" style={{ marginTop: 'calc(env(safe-area-inset-top) + 56px)' }}>
        <input
          type="text"
          placeholder="Title (optional)"
          value={editTitle}
          onChange={(e) => {
            setEditTitle(e.target.value)
            scheduleAutoSave(e.target.value, editBody, editMood)
          }}
          className="w-full bg-transparent text-xl font-semibold text-white outline-none placeholder:text-zinc-600"
        />

        <div className="mt-3 mb-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }} />

        {entry.audio_url && (
          <div className="mb-5 rounded-[18px] px-4 py-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">Voice note</p>
            <audio controls src={entry.audio_url} className="w-full" />
            {transcribeKeyProvider ? (
              <NoApiKeyNotice provider={transcribeKeyProvider} className="mt-2" />
            ) : transcribeError ? (
              <p className="mt-2 text-xs text-red-400">{transcribeError}</p>
            ) : null}
            <div className="mt-2">
              {transcript ? (
                <>
                  <button
                    onClick={() => setShowTranscript(v => !v)}
                    className="text-xs text-zinc-500 underline active:opacity-70"
                  >
                    {showTranscript ? 'Hide transcript' : 'Show transcript'}
                  </button>
                  {showTranscript && (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-zinc-400">{transcript}</p>
                  )}
                </>
              ) : (
                <button
                  onClick={handleTranscribe}
                  disabled={transcribing}
                  className="text-xs text-zinc-500 underline active:opacity-70 disabled:opacity-50"
                >
                  {transcribing ? 'Transcribing…' : 'Generate transcript'}
                </button>
              )}
            </div>
          </div>
        )}

        {isMorning ? (
          /* ─── Morning: day plan ─────────────────────────────────────────── */
          <div>
            {planKeyProvider ? (
              <NoApiKeyNotice provider={planKeyProvider} className="mb-3" />
            ) : planError ? (
              <p className="mb-3 text-sm text-red-400">{planError}</p>
            ) : null}

            {!hasPlanItems && !planning && canPlanFromEntry && (
              <button
                onClick={() => requestPlan()}
                className="flex h-12 w-full items-center justify-center rounded-[16px] text-sm font-semibold text-zinc-300 active:opacity-80 transition-all"
                style={{
                  background: 'rgba(251,191,36,0.06)',
                  border: '1px solid rgba(251,191,36,0.2)',
                }}
              >
                <span className="flex items-center gap-2">
                  <span>☀️</span>
                  Plan my day
                </span>
              </button>
            )}

            {planning && !hasPlanItems && (
              <div
                className="flex h-12 w-full items-center justify-center rounded-[16px] text-sm font-semibold text-zinc-400"
                style={{ background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}
              >
                <span className="flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Building your plan…
                </span>
              </div>
            )}

            {(hasPlanItems || (!canPlanFromEntry && !planning)) && (
              <div>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
                  ☀️ Today&apos;s plan
                </p>
                <div className={`space-y-1 ${planning ? 'opacity-50' : ''}`}>
                  {plan.map((item) => (
                    <div key={item.id} className="group flex items-start gap-3 rounded-xl px-1 py-1.5">
                      <button
                        onClick={() => togglePlanItem(item.id)}
                        className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors"
                        style={{
                          background: item.done ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)',
                          border: item.done ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.15)',
                        }}
                      >
                        {item.done && <span className="text-[11px] leading-none text-amber-300">✓</span>}
                      </button>
                      {/* textarea (not input) so long tasks wrap onto new lines
                          under the same checkbox instead of trailing off-screen */}
                      <textarea
                        value={item.text}
                        rows={1}
                        ref={(el) => {
                          if (el) {
                            el.style.height = 'auto'
                            el.style.height = el.scrollHeight + 'px'
                          }
                        }}
                        autoFocus={focusItemId === item.id}
                        placeholder="What's the move?"
                        onChange={(e) => {
                          editPlanItem(item.id, e.target.value)
                          autoGrow(e.target)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            addPlanItem(item.id)
                          }
                        }}
                        className={`min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-zinc-700 transition-colors ${
                          item.done
                            ? 'text-zinc-500 line-through decoration-zinc-600'
                            : 'text-white'
                        }`}
                      />
                      <button
                        onClick={() => deletePlanItem(item.id)}
                        className="px-1 text-zinc-700 active:text-zinc-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => addPlanItem()}
                  className="mt-2 px-1 text-sm text-zinc-600 active:text-zinc-400"
                >
                  + Add a line
                </button>
              </div>
            )}

            {/* Morning feeling — how he feels about the day ahead */}
            <div className="mt-6">
              <p className="mb-2 text-xs text-zinc-500">How are you feeling about today?</p>
              <div className="flex gap-2">
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      const next = editMood === n ? null : n
                      setEditMood(next)
                      scheduleAutoSave(editTitle, editBody, next)
                    }}
                    className={`flex-1 rounded-full py-2 text-2xl transition-colors ${
                      editMood === n ? 'bg-white' : 'bg-zinc-900 active:opacity-80'
                    }`}
                  >
                    {MOOD_EMOJIS[n]}
                  </button>
                ))}
              </div>
            </div>

            {/* Refine — voice or text, once a plan exists */}
            {hasPlanItems && (
              <>
                {rec.error && <p className="mt-3 text-xs text-red-400">{rec.error}</p>}
                {rec.recording ? (
                  <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      <span className="text-sm tabular-nums text-white">{formatElapsed(rec.elapsed)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button onClick={rec.reset} className="text-xs text-zinc-500 underline active:opacity-70">Cancel</button>
                      <button
                        onClick={rec.stop}
                        className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black active:opacity-80"
                      >
                        Stop
                      </button>
                    </div>
                  </div>
                ) : rec.previewUrl ? (
                  <div className="mt-6 space-y-2 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                    <audio controls src={rec.previewUrl} className="w-full" />
                    <div className="flex items-center justify-end gap-4">
                      <button onClick={rec.reset} className="text-xs text-zinc-500 underline active:opacity-70">Discard</button>
                      <button
                        onClick={handleVoiceRefine}
                        disabled={planning}
                        className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50 active:opacity-80"
                      >
                        {planning ? 'Updating…' : 'Update plan'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 flex gap-3 items-end">
                    <textarea
                      value={refineText}
                      onChange={e => setRefineText(e.target.value)}
                      placeholder="Change the plan… (“move the run after the gym”)"
                      rows={2}
                      className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-white/20"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleTextRefine()
                        }
                      }}
                    />
                    <button
                      onClick={rec.start}
                      disabled={planning}
                      className="px-3 py-3 rounded-2xl bg-white/10 text-base disabled:opacity-30"
                      title="Record a change"
                    >
                      🎙️
                    </button>
                    <button
                      onClick={handleTextRefine}
                      disabled={!refineText.trim() || planning}
                      className="px-4 py-3 rounded-2xl bg-white/10 text-sm text-white disabled:opacity-30 transition-opacity"
                    >
                      {planning ? '…' : 'Update'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* ─── Night: reflection (unchanged) ─────────────────────────────── */
          <>
            <textarea
              ref={bodyTextareaRef}
              value={editBody}
              onChange={(e) => {
                setEditBody(e.target.value)
                autoGrow(e.target)
                scheduleAutoSave(editTitle, e.target.value, editMood)
              }}
              rows={8}
              className="w-full resize-none bg-transparent text-base text-white outline-none"
            />

            <div className="mt-6">
              <p className="mb-2 text-xs text-zinc-500">How are you feeling?</p>
              <div className="flex gap-2">
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => {
                      const next = editMood === n ? null : n
                      setEditMood(next)
                      scheduleAutoSave(editTitle, editBody, next)
                    }}
                    className={`flex-1 rounded-full py-2 text-2xl transition-colors ${
                      editMood === n ? 'bg-white' : 'bg-zinc-900 active:opacity-80'
                    }`}
                  >
                    {MOOD_EMOJIS[n]}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-6 mb-6" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }} />

            <div>
              {(displayReflection || streaming) ? (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-green-700">✦ ATLAS</span>
                    {streaming && (
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-600/60 align-middle" />
                    )}
                  </div>
                  <div
                    className="rounded-[16px] px-4 py-3 mb-2"
                    style={{
                      background: 'rgba(74,222,128,0.04)',
                      border: '1px solid rgba(74,222,128,0.12)',
                      borderLeft: '2px solid rgba(74,222,128,0.3)',
                    }}
                  >
                    <ChatText
                      className="text-[15px] italic leading-relaxed text-zinc-300"
                      text={displayReflection ?? ''}
                      cursor={streaming ? <span className="ml-1 inline-block h-[15px] w-[2px] bg-green-400/60 align-middle animate-pulse" /> : undefined}
                    />
                  </div>
                  <div className="mt-2 flex gap-4">
                    {savedReflection && !streaming && (
                      <button
                        onClick={handleGetReflection}
                        disabled={streaming || isReplying}
                        className="text-xs text-zinc-600 underline active:opacity-70"
                      >
                        Regenerate
                      </button>
                    )}
                    {displayReflection && !streaming && (
                      <button
                        onClick={() => handleGoLonger(-1)}
                        disabled={isReplying}
                        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                      >
                        Go longer →
                      </button>
                    )}
                  </div>

                  {/* Follow-up conversation thread */}
                  {conversation.length > 0 && (
                    <div className="mt-6 space-y-4">
                      {conversation.map((msg, i) => (
                        <div key={i} className={msg.role === 'user' ? 'text-right' : ''}>
                          {msg.role === 'user' ? (
                            <div
                              className="inline-block rounded-2xl px-4 py-3 text-sm text-white max-w-[85%] text-left"
                              style={{ background: 'rgba(255,255,255,0.08)' }}
                            >
                              {msg.audio_url && (
                                <audio controls src={msg.audio_url} className="mb-2 w-full min-w-[220px]" />
                              )}
                              {msg.audio_url ? (
                                <span className="text-xs italic text-white/60">{msg.content}</span>
                              ) : (
                                msg.content
                              )}
                            </div>
                          ) : (
                            <div
                              className="rounded-[16px] px-4 py-3"
                              style={{
                                background: 'rgba(74,222,128,0.04)',
                                border: '1px solid rgba(74,222,128,0.12)',
                                borderLeft: '2px solid rgba(74,222,128,0.25)',
                              }}
                            >
                              <ChatText className="text-sm italic leading-relaxed text-zinc-300" text={msg.content} />
                              <button
                                onClick={() => handleGoLonger(i)}
                                disabled={isReplying}
                                className="text-xs text-zinc-700 hover:text-zinc-500 mt-1.5 transition-colors"
                              >
                                Go longer →
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* In-progress streaming reply */}
                  {streamingReply && (
                    <div
                      className="mt-4 rounded-[16px] px-4 py-3"
                      style={{
                        background: 'rgba(74,222,128,0.04)',
                        border: '1px solid rgba(74,222,128,0.12)',
                        borderLeft: '2px solid rgba(74,222,128,0.25)',
                      }}
                    >
                      <ChatText
                        className="text-sm italic leading-relaxed text-zinc-300"
                        text={streamingReply}
                        cursor={<span className="ml-1 inline-block h-[13px] w-[2px] bg-green-400/60 align-middle animate-pulse" />}
                      />
                    </div>
                  )}

                  {replyKeyProvider ? (
                    <NoApiKeyNotice provider={replyKeyProvider} className="mt-3" />
                  ) : replyError ? (
                    <p className="mt-3 text-sm text-red-400">{replyError}</p>
                  ) : null}

                  {/* Reply input */}
                  {rec.error && <p className="mt-3 text-xs text-red-400">{rec.error}</p>}
                  {rec.recording ? (
                    <div className="mt-6 flex items-center justify-between rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                        <span className="text-sm tabular-nums text-white">{formatElapsed(rec.elapsed)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <button onClick={rec.reset} className="text-xs text-zinc-500 underline active:opacity-70">Cancel</button>
                        <button
                          onClick={rec.stop}
                          className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black active:opacity-80"
                        >
                          Stop
                        </button>
                      </div>
                    </div>
                  ) : rec.previewUrl ? (
                    <div className="mt-6 space-y-2 rounded-2xl bg-white/5 border border-white/10 px-4 py-3">
                      <audio controls src={rec.previewUrl} className="w-full" />
                      <div className="flex items-center justify-end gap-4">
                        <button onClick={rec.reset} className="text-xs text-zinc-500 underline active:opacity-70">Discard</button>
                        <button
                          onClick={handleVoiceReply}
                          disabled={isReplying}
                          className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black disabled:opacity-50 active:opacity-80"
                        >
                          {isReplying ? 'Sending…' : 'Send voice reply'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-6 flex gap-3 items-end">
                      <textarea
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        placeholder="Reply..."
                        rows={2}
                        className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-white/25 resize-none focus:outline-none focus:border-white/20"
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            handleReply()
                          }
                        }}
                      />
                      <button
                        onClick={rec.start}
                        disabled={isReplying}
                        className="px-3 py-3 rounded-2xl bg-white/10 text-base disabled:opacity-30"
                        title="Record a voice reply"
                      >
                        🎙️
                      </button>
                      <button
                        onClick={handleReply}
                        disabled={!replyText.trim() || isReplying}
                        className="px-4 py-3 rounded-2xl bg-white/10 text-sm text-white disabled:opacity-30 transition-opacity"
                      >
                        {isReplying ? '…' : 'Send'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {streamKeyProvider ? (
                    <NoApiKeyNotice provider={streamKeyProvider} className="mb-3" />
                  ) : streamError ? (
                    <p className="mb-3 text-sm text-red-400">{streamError}</p>
                  ) : null}
                  <button
                    onClick={handleGetReflection}
                    disabled={streaming}
                    className="flex h-12 w-full items-center justify-center rounded-[16px] text-sm font-semibold text-zinc-300 active:opacity-80 transition-all disabled:opacity-40"
                    style={{
                      background: 'rgba(74,222,128,0.06)',
                      border: '1px solid rgba(74,222,128,0.2)',
                    }}
                  >
                    {streaming ? (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        Getting reflection…
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="text-green-700">✦</span>
                        Get reflection
                      </span>
                    )}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pb-10"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-base font-semibold">Delete entry?</p>
            <p className="mb-6 text-sm text-zinc-400">This can&apos;t be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl text-sm font-medium text-white active:opacity-80"
                style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteEntry.isPending}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
              >
                {deleteEntry.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
