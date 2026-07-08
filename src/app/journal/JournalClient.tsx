'use client'

import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { useJournalEntries } from '@/features/journal/queries'
import { useDeleteEntry } from '@/features/journal/mutations'
import type { JournalEntry } from '@/features/journal/types'

interface Props {
  initialData: JournalEntry[]
}

const MOOD_DOT: Record<number, { bg: string; glow: string }> = {
  1: { bg: '#ef4444', glow: 'rgba(239,68,68,0.55)' },
  2: { bg: '#f97316', glow: 'rgba(249,115,22,0.55)' },
  3: { bg: '#facc15', glow: 'rgba(250,204,21,0.55)' },
  4: { bg: '#4ade80', glow: 'rgba(74,222,128,0.55)' },
  5: { bg: '#34d399', glow: 'rgba(52,211,153,0.55)' },
}

function groupByMonth(entries: JournalEntry[]) {
  const groups = new Map<string, JournalEntry[]>()
  for (const entry of entries) {
    const key = format(new Date(entry.date + 'T12:00:00'), 'yyyy-MM')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(entry)
  }
  return Array.from(groups.entries()).map(([key, items]) => ({
    key,
    label: format(new Date(items[0].date + 'T12:00:00'), 'MMMM yyyy'),
    items,
  }))
}

export default function JournalClient({ initialData }: Props) {
  const queryClient = useQueryClient()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const deleteEntry = useDeleteEntry()

  useEffect(() => {
    queryClient.setQueryData(['journal'], initialData)
  }, [queryClient, initialData])

  const { data: entries } = useJournalEntries()
  const list = entries ?? initialData

  const groups = groupByMonth(list)

  return (
    <main className="nebula-journal min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold italic tracking-tight text-white leading-tight">Journal</h1>
          <p className="text-xs text-zinc-600 mt-0.5">thoughts · moods · reflections</p>
        </div>
        <Link
          href="/journal/new"
          className="flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white active:opacity-80"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          + New
        </Link>
      </div>

      {list.length === 0 && (
        <p className="text-zinc-600 italic text-sm">Nothing here yet. Write your first entry.</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-600">{group.label}</span>
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>
          <div className="flex flex-col gap-2">
            {group.items.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <Link
                  href={`/journal/${entry.id}`}
                  className="flex flex-1 items-center justify-between rounded-[18px] px-5 py-4 active:opacity-80 transition-all duration-150"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-zinc-600 mb-0.5 font-medium tracking-wide">
                      {format(new Date(entry.date + 'T12:00:00'), 'EEE, MMM d')}
                    </p>
                    <p className="truncate text-[15px] font-semibold text-white leading-snug">
                      <span className="mr-1.5">{entry.kind === 'morning' ? '☀️' : '🌙'}</span>
                      {entry.title ||
                        entry.body.slice(0, 80) ||
                        (entry.kind === 'morning'
                          ? entry.plan?.[0]?.text || 'Morning plan'
                          : entry.audio_path ? 'Voice note' : '')}
                    </p>
                  </div>
                  {entry.mood != null && (
                    <div
                      className="ml-4 h-3 w-3 flex-shrink-0 rounded-full"
                      style={{
                        background: MOOD_DOT[entry.mood].bg,
                        boxShadow: `0 0 8px ${MOOD_DOT[entry.mood].glow}`,
                      }}
                    />
                  )}
                </Link>
                <button
                  onClick={() => setConfirmId(entry.id)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[18px] text-lg text-zinc-700 active:text-zinc-400 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {confirmId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pb-10"
          onClick={() => setConfirmId(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl p-6"
            style={{ background: '#111113', border: '1px solid rgba(255,255,255,0.1)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-base font-semibold">Delete entry?</p>
            <p className="mb-6 text-sm text-zinc-400">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmId(null)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteEntry.mutate(confirmId, { onSuccess: () => setConfirmId(null) })}
                disabled={deleteEntry.isPending}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
              >
                {deleteEntry.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
