'use client'

import Link from 'next/link'
import { format, startOfWeek, getISOWeek } from 'date-fns'
import { useWorkouts } from '@/features/workouts/queries'
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

export default function WorkoutsPage() {
  const { data: workouts, isPending, error } = useWorkouts()

  return (
    <main className="min-h-screen px-6 pb-10 pt-14">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Workouts</h1>
        <Link
          href="/workouts/new"
          className="flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black active:opacity-80"
        >
          + Log
        </Link>
      </div>

      <Link href="/" className="mb-6 inline-block text-sm text-zinc-500 active:text-zinc-300">
        ← Home
      </Link>

      {isPending && (
        <p className="text-zinc-500">Loading…</p>
      )}
      {error && (
        <p className="text-red-400 text-sm">{String(error)}</p>
      )}

      {workouts && workouts.length === 0 && (
        <p className="text-zinc-500">No workouts yet. Log your first one.</p>
      )}

      {workouts && groupByWeek(workouts.filter((w) => w.completed_at)).map((group) => (
        <section key={group.weekStart} className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            {group.label}
          </h2>
          <div className="flex flex-col gap-2">
            {group.items.map((workout) => {
              const vol = totalVolume(workout)
              return (
                <Link
                  key={workout.id}
                  href={`/workouts/${workout.id}`}
                  className="flex items-center justify-between rounded-xl bg-zinc-900 px-5 py-4 active:opacity-80"
                >
                  <div>
                    <p className="font-semibold">
                      {workout.name || 'Workout'}
                    </p>
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
              )
            })}
          </div>
        </section>
      ))}
    </main>
  )
}
