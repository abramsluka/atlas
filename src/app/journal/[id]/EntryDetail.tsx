'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import { useJournalEntry } from '@/features/journal/queries'
import { useUpdateEntry, useDeleteEntry } from '@/features/journal/mutations'
import type { JournalEntry } from '@/features/journal/types'

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

  const [reflectionText, setReflectionText] = useState(entry.ai_reflection ?? '')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function scheduleAutoSave(title: string, body: string, mood: number | null) {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      if (!body.trim()) return
      updateEntry.mutate({
        id: entry.id,
        title: title.trim() || undefined,
        body: body.trim(),
        mood,
      })
    }, 1000)
  }

  async function handleSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    await updateEntry.mutateAsync({
      id: entry.id,
      title: editTitle.trim() || undefined,
      body: editBody.trim(),
      mood: editMood,
    })
    router.back()
  }

  async function handleGetReflection() {
    setStreaming(true)
    setStreamError(null)
    setReflectionText('')

    try {
      const res = await fetch(`/api/journal/${entry.id}/reflect`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const text = await res.text()
        throw new Error(text || 'Failed to get reflection')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setReflectionText((prev) => prev + decoder.decode(value, { stream: true }))
      }

      queryClient.invalidateQueries({ queryKey: ['journal', entry.id] })
    } catch (err) {
      setStreamError(String(err))
    } finally {
      setStreaming(false)
    }
  }

  async function handleDelete() {
    await deleteEntry.mutateAsync(entry.id)
    router.replace('/journal')
  }

  const dateLabel = format(new Date(entry.date + 'T12:00:00'), 'EEE, MMM d')
  const savedReflection = entry.ai_reflection
  const displayReflection = reflectionText || savedReflection

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div
        className="fixed left-0 right-0 top-0 z-10 border-b border-zinc-900 bg-black"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => router.back()}
            className="px-1 py-2 text-sm text-zinc-400 active:text-zinc-200"
          >
            ← Back
          </button>

          <span className="text-sm text-zinc-500">{dateLabel}</span>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2 text-zinc-600 active:text-zinc-400"
            >
              <TrashIcon />
            </button>
            <button
              onClick={handleSave}
              disabled={updateEntry.isPending || !editBody.trim()}
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

        <div className="mt-3 mb-4 border-b border-zinc-800" />

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

        <div className="mt-6 mb-6 border-b border-zinc-800" />

        <div>
          {(displayReflection || streaming) ? (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Atlas
                {streaming && (
                  <span className="ml-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400 align-middle" />
                )}
              </p>
              <p className="text-base italic leading-relaxed text-zinc-300">
                {displayReflection}
              </p>
              {savedReflection && !streaming && (
                <button
                  onClick={handleGetReflection}
                  disabled={streaming}
                  className="mt-3 text-xs text-zinc-600 underline active:opacity-70"
                >
                  Regenerate
                </button>
              )}
            </>
          ) : (
            <>
              {streamError && (
                <p className="mb-3 text-sm text-red-400">{streamError}</p>
              )}
              <button
                onClick={handleGetReflection}
                disabled={streaming}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-zinc-300 active:opacity-80"
              >
                Get reflection
              </button>
            </>
          )}
        </div>
      </div>

      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pb-10"
          onClick={() => setConfirmDelete(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-base font-semibold">Delete entry?</p>
            <p className="mb-6 text-sm text-zinc-400">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
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
