'use client'

import Link from 'next/link'
import { useState } from 'react'
import { format, startOfWeek } from 'date-fns'
import { useWorkouts } from '@/features/workouts/queries'
import { useDeleteWorkout } from '@/features/workouts/mutations'
import type { WorkoutWithExercises } from '@/features/workouts/types'

function totalVolume(workout: WorkoutWithExercises): number {
  return workout.exercises.reduce((total, ex) => {
    return total + ex.sets.reduce((s, set) => {
      if (!set.completed) return s
      return s + (set.weight_lbs ?? 0) * (set.reps ?? 0)
    }, 0)
  }, 0)
}

function groupByWeek(workouts: WorkoutWithExercises[]) {
  const groups = new Map<string, WorkoutWithExercises[]>()
  for (const w of workouts) {
    const date = new Date(w.created_at)
    const weekStart = startOfWeek(date, { weekStartsOn: 1 })
    const key = format(weekStart, 'yyyy-MM-dd')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(w)
  }
  return Array.from(groups.entries()).map(([weekStart, items]) => ({
    weekStart,
    label: `Week of ${format(new Date(weekStart), 'MMM d')}`,
    items,
  }))
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

export default function WorkoutHistoryPage() {
  const { data: workouts, isPending, error } = useWorkouts()
  const deleteWorkout = useDeleteWorkout()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const inProgress = (workouts ?? []).filter((w) => !w.completed_at)
  const completed = (workouts ?? []).filter((w) => w.completed_at)

  function handleDelete(id: string) {
    deleteWorkout.mutate(id, {
      onSuccess: () => setConfirmId(null),
    })
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <Link
          href="/workouts/new"
          className="flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black active:opacity-80"
        >
          + Log
        </Link>
      </div>

      {isPending && <p className="text-zinc-500">Loading…</p>}
      {error && <p className="text-sm text-red-400">{String(error)}</p>}

      {inProgress.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            In Progress
          </h2>
          <div className="flex flex-col gap-2">
            {inProgress.map((workout) => (
              <div key={workout.id} className="flex items-center gap-2">
                <Link
                  href={`/workouts/new?id=${workout.id}`}
                  className="flex flex-1 items-center justify-between rounded-xl bg-zinc-900 px-5 py-4 active:opacity-80"
                >
                  <div>
                    <p className="font-semibold">{workout.name || 'Untitled workout'}</p>
                    <p className="text-sm text-zinc-400">
                      {format(new Date(workout.created_at), 'EEE, MMM d')}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-zinc-500">Continue →</span>
                </Link>
                <button
                  onClick={() => setConfirmId(workout.id)}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600 active:text-zinc-400"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {completed.length === 0 && !isPending && inProgress.length === 0 && (
        <p className="text-zinc-500">No workouts yet. Log your first one.</p>
      )}

      {groupByWeek(completed).map((group) => (
        <section key={group.weekStart} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {group.label}
          </h2>
          <div className="flex flex-col gap-2">
            {group.items.map((workout) => {
              const vol = totalVolume(workout)
              return (
                <div key={workout.id} className="flex items-center gap-2">
                  <Link
                    href={`/workouts/${workout.id}`}
                    className="flex flex-1 items-center justify-between rounded-xl bg-zinc-900 px-5 py-4 active:opacity-80"
                  >
                    <div>
                      <p className="font-semibold">{workout.name || 'Workout'}</p>
                      <p className="text-sm text-zinc-400">
                        {format(new Date(workout.created_at), 'EEE, MMM d')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">
                        {vol > 0 ? `${vol.toLocaleString()} lbs` : '—'}
                      </p>
                      <p className="text-xs text-zinc-500">total volume</p>
                    </div>
                  </Link>
                  <button
                    onClick={() => setConfirmId(workout.id)}
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-600 active:text-zinc-400"
                  >
                    <TrashIcon />
                  </button>
                </div>
              )
            })}
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
            <p className="mb-1 text-base font-semibold">Delete workout?</p>
            <p className="mb-6 text-sm text-zinc-400">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmId(null)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmId)}
                disabled={deleteWorkout.isPending}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
              >
                {deleteWorkout.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
