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

const MOOD_COLORS: Record<number, string> = {
  1: 'bg-red-500',
  2: 'bg-orange-500',
  3: 'bg-yellow-400',
  4: 'bg-green-400',
  5: 'bg-emerald-400',
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
    <main className="min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Journal</h1>
        <Link
          href="/journal/new"
          className="flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black active:opacity-80"
        >
          + New
        </Link>
      </div>

      {list.length === 0 && (
        <p className="text-zinc-500">No entries yet. Write your first one.</p>
      )}

      {groups.map((group) => (
        <section key={group.key} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {group.label}
          </h2>
          <div className="flex flex-col gap-2">
            {group.items.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2">
                <Link
                  href={`/journal/${entry.id}`}
                  className="flex flex-1 items-center justify-between rounded-xl bg-zinc-900 px-5 py-4 active:opacity-80"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-400">
                      {format(new Date(entry.date + 'T12:00:00'), 'EEE, MMM d')}
                    </p>
                    <p className="truncate font-semibold">
                      {entry.title || entry.body.slice(0, 80)}
                    </p>
                  </div>
                  {entry.mood != null && (
                    <div
                      className={`ml-4 h-3 w-3 flex-shrink-0 rounded-full ${MOOD_COLORS[entry.mood]}`}
                    />
                  )}
                </Link>
                <button
                  onClick={() => setConfirmId(entry.id)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-lg text-zinc-600 active:text-zinc-400"
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
            className="mx-4 w-full max-w-sm rounded-2xl bg-zinc-900 p-6"
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
