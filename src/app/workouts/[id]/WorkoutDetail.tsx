'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import type { WorkoutWithExercises } from '@/features/workouts/types'

interface Props {
  workout: WorkoutWithExercises
  initialCoachResponse: string | null
}

function totalVolume(workout: WorkoutWithExercises): number {
  return workout.exercises.reduce((total, ex) => {
    return total + ex.sets.reduce((s, set) => {
      if (!set.completed) return s
      return s + (set.weight_lbs ?? 0) * (set.reps ?? 0)
    }, 0)
  }, 0)
}

export default function WorkoutDetail({ workout, initialCoachResponse }: Props) {
  const [coachText, setCoachText] = useState(initialCoachResponse ?? '')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const hasStreamed = useRef(false)

  useEffect(() => {
    if (initialCoachResponse) return
    if (!workout.completed_at) return
    if (hasStreamed.current) return
    hasStreamed.current = true

    setStreaming(true)
    setStreamError(null)

    const controller = new AbortController()

    ;(async () => {
      try {
        const res = await fetch(`/api/workouts/${workout.id}/coach`, {
          method: 'POST',
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const text = await res.text()
          throw new Error(text || 'Failed to load coach response')
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          setCoachText((prev) => prev + decoder.decode(value, { stream: true }))
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setStreamError(String(err))
      } finally {
        setStreaming(false)
      }
    })()

    return () => controller.abort()
  }, [workout.id, workout.completed_at, initialCoachResponse])

  const vol = totalVolume(workout)

  return (
    <main className="min-h-screen px-6 pb-10 pt-14">
      <div className="mb-8 flex items-center gap-4">
        <Link href="/workouts" className="text-sm text-zinc-500 active:text-zinc-300">
          ← History
        </Link>
      </div>

      <h1 className="mb-1 text-3xl font-bold tracking-tight">
        {workout.name || 'Workout'}
      </h1>
      <p className="mb-6 text-zinc-400">
        {format(new Date(workout.created_at), 'EEEE, MMMM d, yyyy')}
      </p>

      {vol > 0 && (
        <div className="mb-8 rounded-xl bg-zinc-900 px-5 py-4">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Total Volume</p>
          <p className="mt-1 text-4xl font-bold">{vol.toLocaleString()}</p>
          <p className="text-sm text-zinc-400">lbs</p>
        </div>
      )}

      <div className="mb-8 flex flex-col gap-4">
        {workout.exercises
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .map((exercise) => (
            <div key={exercise.id} className="rounded-xl bg-zinc-900 px-4 py-4">
              <h2 className="mb-3 font-semibold">{exercise.name || 'Unnamed exercise'}</h2>
              {exercise.sets.length === 0 && (
                <p className="text-sm text-zinc-500">No sets</p>
              )}
              {exercise.sets
                .slice()
                .sort((a, b) => a.order_index - b.order_index)
                .map((set, i) => (
                  <div
                    key={set.id}
                    className={`mb-1 flex items-center gap-3 text-sm ${
                      set.completed ? '' : 'opacity-40'
                    }`}
                  >
                    <span className="w-5 text-zinc-500">{i + 1}</span>
                    <span className="font-semibold">
                      {set.reps ?? '—'} × {set.weight_lbs ?? '—'} lbs
                    </span>
                    {set.rpe != null && (
                      <span className="text-zinc-400">RPE {set.rpe}</span>
                    )}
                    {set.completed && (
                      <span className="ml-auto text-zinc-500">✓</span>
                    )}
                  </div>
                ))}
            </div>
          ))}
      </div>

      {workout.completed_at && (
        <div className="rounded-xl bg-zinc-900 px-5 py-5">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="font-semibold">Coach</h2>
            {streaming && (
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" />
            )}
          </div>

          {streamError && (
            <p className="text-sm text-red-400">{streamError}</p>
          )}

          {!coachText && !streaming && !streamError && (
            <p className="text-sm text-zinc-500">No response yet.</p>
          )}

          {coachText && (
            <p className="leading-relaxed text-zinc-200 whitespace-pre-wrap">{coachText}</p>
          )}
        </div>
      )}
    </main>
  )
}
