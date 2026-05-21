'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useCreateWorkout,
  useUpdateWorkoutName,
  useAddExercise,
  useUpdateExerciseName,
  useAddSet,
  useUpdateSet,
  useToggleSetComplete,
  useFinishWorkout,
} from '@/features/workouts/mutations'

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
  const router = useRouter()
  const [workout, setWorkout] = useState<LocalWorkout | null>(null)
  const created = useRef(false)

  const createWorkout = useCreateWorkout()
  const updateName = useUpdateWorkoutName(workout?.id ?? '')
  const addExercise = useAddExercise(workout?.id ?? '')
  const updateExerciseName = useUpdateExerciseName()
  const addSet = useAddSet(workout?.id ?? '')
  const updateSet = useUpdateSet()
  const toggleComplete = useToggleSetComplete(workout?.id ?? '')
  const finishWorkout = useFinishWorkout()

  useEffect(() => {
    if (created.current) return
    created.current = true
    createWorkout.mutate(undefined, {
      onSuccess: (data) => {
        setWorkout({ id: data.id, name: '', exercises: [] })
      },
    })
  }, [])

  const saveWorkoutName = useDebounced(() => {
    if (!workout) return
    updateName.mutate(workout.name)
  }, 500)

  if (createWorkout.isPending || !workout) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">Starting workout…</p>
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
    // Debounce per-exercise
    const save = () => updateExerciseName.mutate({ id: exerciseId, name })
    const timer = setTimeout(save, 500)
    return () => clearTimeout(timer)
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
                            {
                              id: data.id,
                              reps: '',
                              weight_lbs: '',
                              rpe: '',
                              completed: false,
                            },
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

    const timer = setTimeout(() => {
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

    return () => clearTimeout(timer)
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

  function handleFinish() {
    finishWorkout.mutate(workout!.id, {
      onSuccess: (id) => {
        router.push(`/workouts/${id}`)
      },
    })
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-14">
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={() => router.push('/')}
          className="text-sm text-zinc-500 active:text-zinc-300"
        >
          ← Cancel
        </button>
        <h1 className="text-2xl font-bold tracking-tight">New Workout</h1>
      </div>

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

interface ExerciseCardProps {
  exercise: LocalExercise
  exerciseIndex: number
  onNameChange: (name: string) => void
  onAddSet: () => void
  onSetChange: (setId: string, field: 'reps' | 'weight_lbs' | 'rpe', value: string) => void
  onToggleComplete: (setId: string, current: boolean) => void
}

function ExerciseCard({
  exercise,
  exerciseIndex,
  onNameChange,
  onAddSet,
  onSetChange,
  onToggleComplete,
}: ExerciseCardProps) {
  return (
    <div className="rounded-xl bg-zinc-900 px-4 py-4">
      <input
        type="text"
        value={exercise.name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={`Exercise ${exerciseIndex + 1}`}
        className="mb-4 w-full bg-transparent text-lg font-semibold text-white placeholder:text-zinc-600 outline-none"
      />

      {exercise.sets.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 grid grid-cols-[2rem_1fr_1fr_1fr_2.5rem] gap-2 text-xs font-medium uppercase tracking-wider text-zinc-600">
            <span></span>
            <span>Reps</span>
            <span>Weight</span>
            <span>RPE</span>
            <span></span>
          </div>
          {exercise.sets.map((set, si) => (
            <SetRow
              key={set.id}
              set={set}
              setIndex={si}
              onFieldChange={(field, value) => onSetChange(set.id, field, value)}
              onToggle={() => onToggleComplete(set.id, set.completed)}
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
}

function SetRow({ set, setIndex, onFieldChange, onToggle }: SetRowProps) {
  return (
    <div
      className={`mb-1 grid grid-cols-[2rem_1fr_1fr_1fr_2.5rem] items-center gap-2 ${
        set.completed ? 'opacity-60' : ''
      }`}
    >
      <span className="text-sm text-zinc-500">{setIndex + 1}</span>

      <input
        type="number"
        inputMode="numeric"
        value={set.reps}
        onChange={(e) => onFieldChange('reps', e.target.value)}
        placeholder="—"
        className="h-10 w-full rounded-lg bg-zinc-800 text-center text-sm text-white placeholder:text-zinc-600 outline-none"
      />
      <input
        type="number"
        inputMode="decimal"
        value={set.weight_lbs}
        onChange={(e) => onFieldChange('weight_lbs', e.target.value)}
        placeholder="—"
        className="h-10 w-full rounded-lg bg-zinc-800 text-center text-sm text-white placeholder:text-zinc-600 outline-none"
      />
      <input
        type="number"
        inputMode="numeric"
        value={set.rpe}
        onChange={(e) => onFieldChange('rpe', e.target.value)}
        placeholder="—"
        min="1"
        max="10"
        className="h-10 w-full rounded-lg bg-zinc-800 text-center text-sm text-white placeholder:text-zinc-600 outline-none"
      />

      <button
        onClick={onToggle}
        className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg transition-colors ${
          set.completed ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-600'
        } active:opacity-80`}
      >
        ✓
      </button>
    </div>
  )
}
