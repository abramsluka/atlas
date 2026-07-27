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

  // One running index across every month so the entries cascade continuously
  // down the page instead of restarting the stagger at each divider. Reset per
  // render; re-renders don't restart CSS animations on elements already mounted.
  let rise = 0
  const riseIn = () => ({ animationDelay: `${Math.min(rise++ * 45, 600)}ms` })

  return (
    <main className="nebula-journal min-h-screen px-6 pb-24 pt-14">
      <div className="rise-in mb-8 flex items-center justify-between" style={riseIn()}>
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
        <p className="rise-in text-zinc-600 italic text-sm" style={riseIn()}>Nothing here yet. Write your first entry.</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="mb-8">
          <div className="rise-in flex items-center gap-3 mb-4" style={riseIn()}>
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
            <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-600">{group.label}</span>
            <div className="h-px flex-1" style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>
          <div className="flex flex-col gap-2">
            {group.items.map((entry) => (
              <div key={entry.id} className="rise-in" style={riseIn()}>
                <div className="flex items-center gap-2">
                  {/* min-w-0 + overflow-hidden: without them iOS ignores the nested
                      truncate and a long line stretches the whole page sideways */}
                  <Link
                    href={`/journal/${entry.id}`}
                    className="flex min-w-0 flex-1 items-center justify-between overflow-hidden rounded-[18px] px-5 py-4 active:opacity-80 transition-all duration-150"
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
                            ? entry.plan?.[0]?.text.slice(0, 80) || 'Morning plan'
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
                    onClick={() => setConfirmId(confirmId === entry.id ? null : entry.id)}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[18px] text-lg text-zinc-700 active:text-zinc-400 transition-colors"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                  >
                    ×
                  </button>
                </div>

                {/* Inline delete confirm, right below the entry (a fixed overlay
                    gets position:relative forced by .nebula-journal > * and lands
                    at the bottom of the page) */}
                {confirmId === entry.id && (
                  <div
                    className="mt-2 flex items-center justify-between rounded-[18px] px-4 py-3"
                    style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
                  >
                    <p className="text-sm text-zinc-300">Delete this entry?</p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setConfirmId(null)}
                        className="rounded-full px-4 py-1.5 text-xs font-medium text-white active:opacity-80"
                        style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => deleteEntry.mutate(entry.id, { onSuccess: () => setConfirmId(null) })}
                        disabled={deleteEntry.isPending}
                        className="rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50 active:opacity-80"
                      >
                        {deleteEntry.isPending ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

    </main>
  )
}
