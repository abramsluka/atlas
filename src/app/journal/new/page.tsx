'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { useCreateEntry } from '@/features/journal/mutations'
import { useVoiceRecorder, formatElapsed } from '@/features/journal/useVoiceRecorder'
import { uploadJournalAudio } from '@/features/journal/uploadAudio'

const MOOD_EMOJIS: Record<number, string> = {
  1: '😔',
  2: '😕',
  3: '😐',
  4: '🙂',
  5: '😄',
}

export default function NewJournalEntryPage() {
  const router = useRouter()
  const createEntry = useCreateEntry()

  const [body, setBody] = useState('')
  const [mood, setMood] = useState<number | null>(null)
  const [today, setToday] = useState('')
  const [todayDisplay, setTodayDisplay] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Reused across retries so a failed upload doesn't spawn duplicate empty entries
  const createdEntryId = useRef<string | null>(null)

  const rec = useVoiceRecorder()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const now = new Date()
    setToday(format(now, 'yyyy-MM-dd'))
    setTodayDisplay(format(now, 'EEEE, MMMM do, yyyy'))
  }, [])

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  async function handleSave() {
    if ((!body.trim() && !rec.blob) || !today) return
    setSaveError(null)
    try {
      // Reuse the entry from a previous failed attempt so retrying doesn't
      // create a second empty entry.
      let entryId = createdEntryId.current
      if (!entryId) {
        const entry = await createEntry.mutateAsync({
          date: today,
          body: body.trim(),
          mood,
        })
        entryId = entry.id
        createdEntryId.current = entry.id
      }

      const file = rec.toFile()
      if (file) {
        setUploading(true)
        // Throws on failure — the recording stays on the page so the user can retry
        await uploadJournalAudio(entryId, file)
      }
      router.replace(`/journal/${entryId}`)
    } catch (err) {
      console.error('Save failed:', err)
      setSaveError(
        rec.blob
          ? "Couldn't upload the recording. Your voice note is still here — tap Save to try again."
          : String(err)
      )
    } finally {
      setUploading(false)
    }
  }

  const canSave = (body.trim().length > 0 || !!rec.blob) && !createEntry.isPending && !uploading && !rec.recording

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div
        className="fixed left-0 right-0 top-0 z-10 border-b border-zinc-900 bg-black"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/journal" className="px-1 py-2 text-sm text-zinc-400 active:text-zinc-200">
            ← Back
          </Link>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className={`px-1 py-2 text-sm font-semibold ${canSave ? 'text-white active:opacity-70' : 'text-zinc-600'}`}
          >
            {createEntry.isPending || uploading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {createEntry.isError && (
        <p className="px-6 pt-2 text-sm text-red-400" style={{ marginTop: 'calc(env(safe-area-inset-top) + 56px)' }}>
          {String(createEntry.error)}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-36" style={{ marginTop: 'calc(env(safe-area-inset-top) + 56px)' }}>
        <p className="mb-4 text-xl font-semibold text-white">{todayDisplay}</p>

        {/* Voice note */}
        <div className="mb-5 rounded-2xl bg-zinc-900 px-4 py-3">
          {rec.error && <p className="mb-2 text-xs text-red-400">{rec.error}</p>}
          {saveError && <p className="mb-2 text-xs text-red-400">{saveError}</p>}
          {!rec.recording && !rec.blob && (
            <button
              onClick={rec.start}
              className="flex w-full items-center gap-3 py-1 text-sm text-zinc-400 active:opacity-70"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-base">🎙️</span>
              Record a voice note
            </button>
          )}
          {rec.recording && (
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                <span className="text-sm tabular-nums text-white">{formatElapsed(rec.elapsed)}</span>
              </div>
              <button
                onClick={rec.stop}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black active:opacity-80"
              >
                Stop
              </button>
            </div>
          )}
          {!rec.recording && rec.previewUrl && (
            <div className="space-y-2">
              <audio controls src={rec.previewUrl} className="w-full" />
              <div className="flex gap-4">
                <button onClick={() => { rec.reset(); rec.start() }} className="text-xs text-zinc-500 underline active:opacity-70">
                  Re-record
                </button>
                <button onClick={rec.reset} className="text-xs text-zinc-500 underline active:opacity-70">
                  Remove
                </button>
              </div>
            </div>
          )}
        </div>

        <textarea
          ref={textareaRef}
          placeholder="What's on your mind?"
          value={body}
          autoFocus
          onChange={(e) => {
            setBody(e.target.value)
            autoGrow(e.target)
          }}
          rows={8}
          className="w-full resize-none bg-transparent text-base text-white outline-none placeholder:text-zinc-600"
        />
      </div>

      <div
        className="fixed bottom-0 left-0 right-0 border-t border-zinc-900 bg-black px-6 py-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
      >
        <p className="mb-2 text-xs text-zinc-500">How are you feeling?</p>
        <div className="flex gap-2">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              onClick={() => setMood(mood === n ? null : n)}
              className={`flex-1 rounded-full py-2 text-2xl transition-colors ${
                mood === n ? 'bg-white' : 'bg-zinc-900 active:opacity-80'
              }`}
            >
              {MOOD_EMOJIS[n]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
