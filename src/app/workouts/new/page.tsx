'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useMutationState } from '@tanstack/react-query'
import {
  useCreateWorkout,
  useUpdateWorkoutName,
  useAddExercise,
  useUpdateExerciseName,
  useAddSet,
  useUpdateSet,
  useToggleSetComplete,
  useFinishWorkout,
  useDeleteWorkout,
  useDeleteExercise,
  useDeleteSet,
} from '@/features/workouts/mutations'
import { useWorkout } from '@/features/workouts/queries'

interface LocalSet {
  id: string
  reps: string
  weight_lbs: string
  rpe: string
  completed: boolean
}

interface LocalExercise {
  id: string
  name: string
  sets: LocalSet[]
}

interface LocalWorkout {
  id: string
  name: string
  exercises: LocalExercise[]
}

function useDebounced(fn: () => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fn, delay)
  }
}

export default function NewWorkoutPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-zinc-500">Loading…</p>
        </div>
      }
    >
      <NewWorkoutContent />
    </Suspense>
  )
}

function NewWorkoutContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const resumeId = searchParams.get('id')

  const [workout, setWorkout] = useState<LocalWorkout | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const created = useRef(false)
  const loadedExisting = useRef(false)

  const createWorkout = useCreateWorkout()
  const updateName = useUpdateWorkoutName(workout?.id ?? '')
  const addExercise = useAddExercise(workout?.id ?? '')
  const updateExerciseName = useUpdateExerciseName()
  const addSet = useAddSet(workout?.id ?? '')
  const updateSet = useUpdateSet()
  const toggleComplete = useToggleSetComplete(workout?.id ?? '')
  const finishWorkout = useFinishWorkout()
  const deleteWorkout = useDeleteWorkout()
  const deleteExercise = useDeleteExercise(workout?.id ?? '')
  const deleteSet = useDeleteSet(workout?.id ?? '')

  const { data: existingWorkout } = useWorkout(resumeId ?? '', { enabled: !!resumeId })

  // Load existing workout into state when resuming
  useEffect(() => {
    if (!existingWorkout || loadedExisting.current) return
    loadedExisting.current = true
    setWorkout({
      id: existingWorkout.id,
      name: existingWorkout.name ?? '',
      exercises: existingWorkout.exercises
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((e) => ({
          id: e.id,
          name: e.name,
          sets: e.sets
            .slice()
            .sort((a, b) => a.order_index - b.order_index)
            .map((s) => ({
              id: s.id,
              reps: s.reps != null ? String(s.reps) : '',
              weight_lbs: s.weight_lbs != null ? String(s.weight_lbs) : '',
              rpe: s.rpe != null ? String(s.rpe) : '',
              completed: s.completed,
            })),
        })),
    })
  }, [existingWorkout])

  // Read created workout from global mutation cache — survives Strict Mode unmount/remount
  const createWorkoutResults = useMutationState({
    filters: { mutationKey: ['create-workout'], status: 'success' },
    select: (mut) => mut.state.data as { id: string } | undefined,
  })

  useEffect(() => {
    const data = createWorkoutResults[createWorkoutResults.length - 1]
    if (data && !workout && !resumeId) {
      setWorkout({ id: data.id, name: '', exercises: [] })
    }
  }, [createWorkoutResults, resumeId, workout])

  // Create new workout when not resuming
  useEffect(() => {
    if (resumeId) return
    if (created.current) return
    created.current = true

    createWorkout.mutate(undefined)

    return () => {
      // intentionally empty — created.current stays true to block Strict Mode's second fire
      // real navigation creates a fresh component instance with created.current = false
    }
  }, [])

  const saveWorkoutName = useDebounced(() => {
    if (!workout) return
    updateName.mutate(workout.name)
  }, 500)

  function flushName() {
    if (!workout) return
    updateName.mutate(workout.name)
  }

  if (!resumeId && createWorkout.isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-red-400 text-sm text-center">Failed to start workout:</p>
        <p className="text-red-300 text-xs text-center font-mono break-all">{String(createWorkout.error)}</p>
        <button
          onClick={() => {
            created.current = false
            createWorkout.reset()
            created.current = true
            createWorkout.mutate(undefined, {
              onSuccess: (data) => setWorkout({ id: data.id, name: '', exercises: [] }),
            })
          }}
          className="mt-2 rounded-xl bg-zinc-800 px-5 py-3 text-sm text-white active:opacity-80"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!workout) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">{resumeId ? 'Loading workout…' : 'Starting workout…'}</p>
      </div>
    )
  }

  function handleNameChange(name: string) {
    setWorkout((w) => w ? { ...w, name } : w)
    saveWorkoutName()
  }

  function handleAddExercise() {
    addExercise.mutate(workout!.exercises.length, {
      onSuccess: (data) => {
        setWorkout((w) =>
          w ? { ...w, exercises: [...w.exercises, { id: data.id, name: '', sets: [] }] } : w
        )
      },
    })
  }

  function handleExerciseNameChange(exerciseId: string, name: string) {
    setWorkout((w) =>
      w
        ? {
            ...w,
            exercises: w.exercises.map((e) =>
              e.id === exerciseId ? { ...e, name } : e
            ),
          }
        : w
    )
    setTimeout(() => updateExerciseName.mutate({ id: exerciseId, name }), 500)
  }

  function handleAddSet(exerciseId: string) {
    const exercise = workout!.exercises.find((e) => e.id === exerciseId)
    if (!exercise) return

    addSet.mutate(
      { exerciseId, orderIndex: exercise.sets.length },
      {
        onSuccess: (data) => {
          setWorkout((w) =>
            w
              ? {
                  ...w,
                  exercises: w.exercises.map((e) =>
                    e.id === exerciseId
                      ? {
                          ...e,
                          sets: [
                            ...e.sets,
                            { id: data.id, reps: '', weight_lbs: '', rpe: '', completed: false },
                          ],
                        }
                      : e
                  ),
                }
              : w
          )
        },
      }
    )
  }

  function handleSetChange(
    exerciseId: string,
    setId: string,
    field: 'reps' | 'weight_lbs' | 'rpe',
    value: string
  ) {
    setWorkout((w) =>
      w
        ? {
            ...w,
            exercises: w.exercises.map((e) =>
              e.id !== exerciseId
                ? e
                : {
                    ...e,
                    sets: e.sets.map((s) =>
                      s.id !== setId ? s : { ...s, [field]: value }
                    ),
                  }
            ),
          }
        : w
    )

    setTimeout(() => {
      const exercise = workout!.exercises.find((e) => e.id === exerciseId)
      const set = exercise?.sets.find((s) => s.id === setId)
      if (!set) return
      const updated = { ...set, [field]: value }
      updateSet.mutate({
        id: setId,
        reps: updated.reps !== '' ? parseInt(updated.reps) : null,
        weight_lbs: updated.weight_lbs !== '' ? parseFloat(updated.weight_lbs) : null,
        rpe: updated.rpe !== '' ? parseInt(updated.rpe) : null,
      })
    }, 500)
  }

  function handleToggleComplete(exerciseId: string, setId: string, current: boolean) {
    const next = !current
    setWorkout((w) =>
      w
        ? {
            ...w,
            exercises: w.exercises.map((e) =>
              e.id !== exerciseId
                ? e
                : {
                    ...e,
                    sets: e.sets.map((s) =>
                      s.id !== setId ? s : { ...s, completed: next }
                    ),
                  }
            ),
          }
        : w
    )
    toggleComplete.mutate({ id: setId, completed: next })
  }

  function handleDeleteSet(exerciseId: string, setId: string) {
    setWorkout((w) =>
      w
        ? {
            ...w,
            exercises: w.exercises.map((e) =>
              e.id !== exerciseId ? e : { ...e, sets: e.sets.filter((s) => s.id !== setId) }
            ),
          }
        : w
    )
    deleteSet.mutate({ exerciseId, setId })
  }

  function handleDeleteExercise(exerciseId: string) {
    setWorkout((w) =>
      w ? { ...w, exercises: w.exercises.filter((e) => e.id !== exerciseId) } : w
    )
    deleteExercise.mutate(exerciseId)
  }

  function handleFinish() {
    finishWorkout.mutate(workout!.id, {
      onSuccess: (id) => {
        router.push(`/workouts/${id}?from=gym`)
      },
    })
  }

  function handleDelete() {
    deleteWorkout.mutate(workout!.id, {
      onSuccess: () => { router.push('/workouts'); router.refresh() },
    })
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={() => { flushName(); router.push('/workouts'); router.refresh() }}
          className="text-sm text-zinc-500 active:text-zinc-300"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold tracking-tight">
          {resumeId ? 'Workout' : 'New Workout'}
        </h1>
        <div className="ml-auto flex items-center gap-4">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-zinc-600 active:text-zinc-400"
            aria-label="Delete workout"
          >
            <TrashIcon />
          </button>
          <button
            onClick={() => { flushName(); router.push('/workouts'); router.refresh() }}
            className="text-sm font-medium text-zinc-400 active:text-zinc-200"
          >
            Save
          </button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pb-10"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl bg-zinc-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-base font-semibold">Delete workout?</p>
            <p className="mb-6 text-sm text-zinc-400">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteWorkout.isPending}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
              >
                {deleteWorkout.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        type="text"
        value={workout.name}
        onChange={(e) => handleNameChange(e.target.value)}
        placeholder="Workout name (optional)"
        className="mb-8 w-full border-b border-zinc-800 bg-transparent pb-3 text-xl font-semibold text-white placeholder:text-zinc-600 outline-none"
      />

      <div className="flex flex-col gap-6">
        {workout.exercises.map((exercise, ei) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            exerciseIndex={ei}
            onNameChange={(name) => handleExerciseNameChange(exercise.id, name)}
            onAddSet={() => handleAddSet(exercise.id)}
            onSetChange={(setId, field, value) =>
              handleSetChange(exercise.id, setId, field, value)
            }
            onToggleComplete={(setId, current) =>
              handleToggleComplete(exercise.id, setId, current)
            }
            onDeleteSet={(setId) => handleDeleteSet(exercise.id, setId)}
            onDeleteExercise={() => handleDeleteExercise(exercise.id)}
          />
        ))}
      </div>

      <button
        onClick={handleAddExercise}
        disabled={addExercise.isPending}
        className="mt-6 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-800 text-sm font-medium text-zinc-400 active:opacity-80 disabled:opacity-50"
      >
        + Add exercise
      </button>

      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-900 bg-black px-6 py-4">
        <button
          onClick={handleFinish}
          disabled={finishWorkout.isPending || workout.exercises.length === 0}
          className="flex h-14 w-full items-center justify-center rounded-xl bg-white text-base font-semibold text-black disabled:opacity-40 active:opacity-80"
        >
          {finishWorkout.isPending ? 'Saving…' : 'Finish Workout'}
        </button>
      </div>
    </main>
  )
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
      className="h-5 w-5"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

interface ExerciseCardProps {
  exercise: LocalExercise
  exerciseIndex: number
  onNameChange: (name: string) => void
  onAddSet: () => void
  onSetChange: (setId: string, field: 'reps' | 'weight_lbs' | 'rpe', value: string) => void
  onToggleComplete: (setId: string, current: boolean) => void
  onDeleteSet: (setId: string) => void
  onDeleteExercise: () => void
}

function ExerciseCard({
  exercise,
  exerciseIndex,
  onNameChange,
  onAddSet,
  onSetChange,
  onToggleComplete,
  onDeleteSet,
  onDeleteExercise,
}: ExerciseCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="rounded-xl bg-zinc-900 px-4 py-4">
      <div className="mb-4 flex items-center gap-2">
        <input
          type="text"
          value={exercise.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={`Exercise ${exerciseIndex + 1}`}
          className="flex-1 bg-transparent text-lg font-semibold text-white placeholder:text-zinc-600 outline-none"
        />
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex-shrink-0 p-1 text-zinc-600 active:text-red-400 transition-colors"
          aria-label="Delete exercise"
        >
          <TrashIcon />
        </button>
      </div>

      {confirmDelete && (
        <div className="mb-4 rounded-xl bg-zinc-800 px-4 py-3">
          <p className="mb-3 text-sm text-zinc-200">
            Delete <span className="font-semibold">{exercise.name || `Exercise ${exerciseIndex + 1}`}</span> and all its sets?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex h-9 flex-1 items-center justify-center rounded-lg bg-zinc-700 text-sm text-white active:opacity-80"
            >
              Cancel
            </button>
            <button
              onClick={onDeleteExercise}
              className="flex h-9 flex-1 items-center justify-center rounded-lg bg-red-600 text-sm font-semibold text-white active:opacity-80"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {exercise.sets.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
            <span className="w-8 flex-shrink-0"></span>
            <span className="flex-1 text-center">Reps</span>
            <span className="flex-1 text-center">Weight</span>
            <span className="flex-1 text-center">RPE</span>
            <span className="w-9 flex-shrink-0"></span>
            <span className="w-8 flex-shrink-0"></span>
          </div>
          {exercise.sets.map((set, si) => (
            <SetRow
              key={set.id}
              set={set}
              setIndex={si}
              onFieldChange={(field, value) => onSetChange(set.id, field, value)}
              onToggle={() => onToggleComplete(set.id, set.completed)}
              onDelete={() => onDeleteSet(set.id)}
            />
          ))}
        </div>
      )}

      <button
        onClick={onAddSet}
        className="text-sm font-medium text-zinc-400 active:text-white"
      >
        + Add set
      </button>
    </div>
  )
}

interface SetRowProps {
  set: LocalSet
  setIndex: number
  onFieldChange: (field: 'reps' | 'weight_lbs' | 'rpe', value: string) => void
  onToggle: () => void
  onDelete: () => void
}

type ActiveField = 'reps' | 'weight_lbs' | 'rpe'

const SLIDER_CONFIG: Record<ActiveField, { min: number; max: number; step: number }> = {
  reps:       { min: 0, max: 20,  step: 1   },
  weight_lbs: { min: 0, max: 300, step: 2.5 },
  rpe:        { min: 0, max: 10,  step: 1   },
}

const DELETE_WIDTH = 72

function SetRow({ set, setIndex, onFieldChange, onToggle, onDelete }: SetRowProps) {
  const [activeField, setActiveField] = useState<ActiveField | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const touchStartX = useRef(0)
  const swipeStartX = useRef(0)

  function tap(field: ActiveField) {
    if (swipeX !== 0) { setSwipeX(0); return }
    if (set.completed) onToggle()
    setActiveField((f) => (f === field && !set.completed ? null : field))
  }

  function handleToggle() {
    if (swipeX !== 0) { setSwipeX(0); return }
    setActiveField(null)
    onToggle()
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX
    swipeStartX.current = swipeX
    setDragging(true)
  }

  function handleTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - touchStartX.current
    const next = Math.max(-DELETE_WIDTH, Math.min(0, swipeStartX.current + dx))
    setSwipeX(next)
  }

  function handleTouchEnd() {
    setDragging(false)
    setSwipeX(swipeX < -(DELETE_WIDTH / 2) ? -DELETE_WIDTH : 0)
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
    <div className="relative mb-2 overflow-hidden">
      {/* Swipe-to-delete target (mobile) */}
      <button
        onClick={onDelete}
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-red-600 text-sm font-semibold text-white"
        style={{ width: DELETE_WIDTH }}
      >
        Delete
      </button>

      {/* Swipeable row */}
      <div
        className={set.completed ? 'opacity-60' : ''}
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
          position: 'relative',
          zIndex: 1,
          backgroundColor: 'rgb(24 24 27)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
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

          {/* Desktop: trash icon */}
          <button
            onClick={onDelete}
            className="hidden md:flex h-9 w-8 flex-shrink-0 items-center justify-center text-zinc-700 hover:text-red-400 transition-colors"
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
    </div>
  )
}
