'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import type { WorkoutWithExercises } from '@/features/workouts/types'
import { useUpdateSet, useToggleSetComplete, useDeleteSet, useDeleteExercise } from '@/features/workouts/mutations'

interface Props {
  workout: WorkoutWithExercises
  initialCoachResponse: string | null
  backHref: string
}

// --- Editable set row ---

interface LocalSet {
  reps: string
  weight_lbs: string
  rpe: string
  completed: boolean
}

type ActiveField = 'reps' | 'weight_lbs' | 'rpe'

const SLIDER_CONFIG: Record<ActiveField, { min: number; max: number; step: number }> = {
  reps:       { min: 0, max: 20,  step: 1   },
  weight_lbs: { min: 0, max: 300, step: 2.5 },
  rpe:        { min: 0, max: 10,  step: 1   },
}

interface SetRowProps {
  set: LocalSet
  setIndex: number
  onFieldChange: (field: ActiveField, value: string) => void
  onToggle: () => void
  onDelete: () => void
}

function SetRow({ set, setIndex, onFieldChange, onToggle, onDelete }: SetRowProps) {
  const [activeField, setActiveField] = useState<ActiveField | null>(null)

  function tap(field: ActiveField) {
    if (set.completed) onToggle()
    setActiveField((f) => (f === field && !set.completed ? null : field))
  }

  function handleToggle() {
    setActiveField(null)
    onToggle()
  }

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    if (!activeField) return
    const v = parseFloat(e.target.value)
    const rounded = Math.round(v * 10) / 10
    onFieldChange(activeField, v === 0 ? '' : String(rounded))
  }

  const cfg = activeField ? SLIDER_CONFIG[activeField] : null
  const sliderVal = activeField && set[activeField] !== '' ? parseFloat(set[activeField]) : 0

  function fieldLabel(field: ActiveField) {
    const v = set[field]
    if (v === '') return '—'
    if (field === 'weight_lbs') return String(Math.round(parseFloat(v) * 10) / 10)
    return v
  }

  return (
    <div className={`mb-2 ${set.completed ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="w-8 flex-shrink-0 text-center text-sm text-zinc-500">
          {setIndex + 1}
        </span>

        {(['reps', 'weight_lbs', 'rpe'] as ActiveField[]).map((field) => (
          <button
            key={field}
            onClick={() => tap(field)}
            className={`flex h-9 flex-1 items-center justify-center rounded-lg text-sm font-medium transition-colors active:opacity-80 ${
              activeField === field
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            {fieldLabel(field)}
          </button>
        ))}

        <button
          onClick={handleToggle}
          className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-base transition-colors ${
            set.completed ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-600'
          } active:opacity-80`}
        >
          ✓
        </button>

        <button
          onClick={onDelete}
          className="flex h-9 w-8 flex-shrink-0 items-center justify-center text-zinc-600 hover:text-red-400 active:text-red-400 transition-colors text-base leading-none"
          aria-label="Delete set"
        >
          ×
        </button>
      </div>

      {activeField && cfg && (
        <div className="mt-2 px-1">
          <input
            type="range"
            min={cfg.min}
            max={cfg.max}
            step={cfg.step}
            value={sliderVal}
            onChange={handleSlider}
            className="w-full accent-white"
          />
        </div>
      )}
    </div>
  )
}

// --- Main component ---

interface WhoopSession {
  strain: number | null
  average_heart_rate: number | null
  max_heart_rate: number | null
  kcal: number | null
}

export default function WorkoutDetail({ workout, initialCoachResponse, backHref }: Props) {
  const router = useRouter()
  const [coachText, setCoachText] = useState(initialCoachResponse ?? '')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const hasStreamed = useRef(false)
  const [whoopSession, setWhoopSession] = useState<WhoopSession | null>(null)

  const [localSets, setLocalSets] = useState<Record<string, LocalSet>>(() => {
    const map: Record<string, LocalSet> = {}
    for (const ex of workout.exercises) {
      for (const set of ex.sets) {
        map[set.id] = {
          reps: set.reps != null ? String(set.reps) : '',
          weight_lbs: set.weight_lbs != null ? String(set.weight_lbs) : '',
          rpe: set.rpe != null ? String(set.rpe) : '',
          completed: set.completed,
        }
      }
    }
    return map
  })

  const updateSet = useUpdateSet()
  const toggleComplete = useToggleSetComplete(workout.id)
  const deleteSet = useDeleteSet(workout.id)
  const deleteExercise = useDeleteExercise(workout.id)

  const [deletedSetIds, setDeletedSetIds] = useState<Set<string>>(new Set())
  const [deletedExerciseIds, setDeletedExerciseIds] = useState<Set<string>>(new Set())
  const [confirmDeleteExerciseId, setConfirmDeleteExerciseId] = useState<string | null>(null)

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

  useEffect(() => {
    if (!workout.completed_at) return
    const start = encodeURIComponent(workout.created_at)
    const end = encodeURIComponent(workout.completed_at)
    fetch(`/api/health/whoop/workout?start=${start}&end=${end}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setWhoopSession(data) })
      .catch(() => {})
  }, [workout.id, workout.created_at, workout.completed_at])

  function handleSetFieldChange(setId: string, field: ActiveField, value: string) {
    setLocalSets((prev) => ({
      ...prev,
      [setId]: { ...prev[setId], [field]: value },
    }))

    const currentSet = localSets[setId]
    setTimeout(() => {
      const updated = { ...currentSet, [field]: value }
      updateSet.mutate({
        id: setId,
        reps: updated.reps !== '' ? parseInt(updated.reps) : null,
        weight_lbs: updated.weight_lbs !== '' ? parseFloat(updated.weight_lbs) : null,
        rpe: updated.rpe !== '' ? parseInt(updated.rpe) : null,
      })
    }, 500)
  }

  function handleToggleComplete(setId: string) {
    const next = !localSets[setId].completed
    setLocalSets((prev) => ({
      ...prev,
      [setId]: { ...prev[setId], completed: next },
    }))
    toggleComplete.mutate({ id: setId, completed: next })
  }

  function handleDeleteSet(exerciseId: string, setId: string) {
    setDeletedSetIds((prev) => new Set(prev).add(setId))
    deleteSet.mutate({ exerciseId, setId })
  }

  function handleDeleteExercise(exerciseId: string) {
    setDeletedExerciseIds((prev) => new Set(prev).add(exerciseId))
    setConfirmDeleteExerciseId(null)
    deleteExercise.mutate(exerciseId)
  }

  function calcVolume() {
    let total = 0
    for (const ex of workout.exercises) {
      for (const set of ex.sets) {
        const local = localSets[set.id]
        if (!local?.completed) continue
        const w = local.weight_lbs !== '' ? parseFloat(local.weight_lbs) : 0
        const r = local.reps !== '' ? parseInt(local.reps) : 0
        total += w * r
      }
    }
    return total
  }

  const vol = calcVolume()

  return (
    <main className="min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={() => { router.push(backHref); router.refresh() }}
          className="text-sm text-zinc-500 active:text-zinc-300"
        >
          ← {backHref === '/workouts' ? 'Gym' : 'History'}
        </button>
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

      {whoopSession && (
        <div className="mb-8 rounded-xl bg-zinc-900 px-5 py-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Whoop Session</p>
          <div className="flex gap-6">
            {whoopSession.strain != null && (
              <div>
                <p className="text-xs text-zinc-500">Strain</p>
                <p className="text-2xl font-bold text-white">{whoopSession.strain.toFixed(1)}</p>
                <p className="text-xs text-zinc-600">/21</p>
              </div>
            )}
            {whoopSession.average_heart_rate != null && (
              <div>
                <p className="text-xs text-zinc-500">Avg HR</p>
                <p className="text-2xl font-bold text-white">{whoopSession.average_heart_rate}</p>
                <p className="text-xs text-zinc-600">bpm</p>
              </div>
            )}
            {whoopSession.max_heart_rate != null && (
              <div>
                <p className="text-xs text-zinc-500">Max HR</p>
                <p className="text-2xl font-bold text-white">{whoopSession.max_heart_rate}</p>
                <p className="text-xs text-zinc-600">bpm</p>
              </div>
            )}
            {whoopSession.kcal != null && (
              <div>
                <p className="text-xs text-zinc-500">Calories</p>
                <p className="text-2xl font-bold text-white">{whoopSession.kcal.toLocaleString()}</p>
                <p className="text-xs text-zinc-600">kcal</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mb-8 flex flex-col gap-4">
        {workout.exercises
          .slice()
          .sort((a, b) => a.order_index - b.order_index)
          .filter((exercise) => !deletedExerciseIds.has(exercise.id))
          .map((exercise) => {
            const visibleSets = exercise.sets
              .slice()
              .sort((a, b) => a.order_index - b.order_index)
              .filter((s) => !deletedSetIds.has(s.id))

            return (
              <div key={exercise.id} className="rounded-xl bg-zinc-900 px-4 py-4">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="flex-1 font-semibold">{exercise.name || 'Unnamed exercise'}</h2>
                  <button
                    onClick={() => setConfirmDeleteExerciseId(
                      confirmDeleteExerciseId === exercise.id ? null : exercise.id
                    )}
                    className="flex-shrink-0 p-1 text-zinc-600 active:text-red-400 transition-colors"
                    aria-label="Delete exercise"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>

                {confirmDeleteExerciseId === exercise.id && (
                  <div className="mb-3 rounded-xl bg-zinc-800 px-4 py-3">
                    <p className="mb-3 text-sm text-zinc-200">
                      Delete <span className="font-semibold">{exercise.name || 'this exercise'}</span> and all its sets?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmDeleteExerciseId(null)}
                        className="flex h-9 flex-1 items-center justify-center rounded-lg bg-zinc-700 text-sm text-white active:opacity-80"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleDeleteExercise(exercise.id)}
                        className="flex h-9 flex-1 items-center justify-center rounded-lg bg-red-600 text-sm font-semibold text-white active:opacity-80"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {visibleSets.length === 0 && !confirmDeleteExerciseId && (
                  <p className="text-sm text-zinc-500">No sets</p>
                )}

                {visibleSets.length > 0 && (
                  <div>
                    <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
                      <span className="w-8 flex-shrink-0" />
                      <span className="flex-1 text-center">Reps</span>
                      <span className="flex-1 text-center">Weight</span>
                      <span className="flex-1 text-center">RPE</span>
                      <span className="w-9 flex-shrink-0" />
                      <span className="w-8 flex-shrink-0" />
                    </div>
                    {visibleSets.map((set, i) => {
                      const local = localSets[set.id]
                      if (!local) return null
                      return (
                        <SetRow
                          key={set.id}
                          set={local}
                          setIndex={i}
                          onFieldChange={(field, value) =>
                            handleSetFieldChange(set.id, field, value)
                          }
                          onToggle={() => handleToggleComplete(set.id)}
                          onDelete={() => handleDeleteSet(exercise.id, set.id)}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
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
