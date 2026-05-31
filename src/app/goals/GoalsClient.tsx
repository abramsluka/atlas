'use client'

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import { useGoalsData } from '@/features/goals/queries'
import {
  useCreateGoal,
  useUpdateGoal,
  useDeleteGoal,
  useLogHabit,
  useUnlogHabit,
} from '@/features/goals/mutations'
import type { Goal, GoalDirection, GoalType, GoalsData, HabitLog } from '@/features/goals/types'

interface Props {
  initialData: GoalsData
  today: string
}

function computeStreak(goalId: string, logs: HabitLog[], today: string): number {
  const dates = logs
    .filter(l => l.goal_id === goalId)
    .map(l => l.date)
    .sort()
    .reverse()

  let streak = 0
  let cursor = today
  for (const date of dates) {
    if (date === cursor) {
      streak++
      const d = new Date(cursor + 'T12:00:00')
      d.setDate(d.getDate() - 1)
      cursor = format(d, 'yyyy-MM-dd')
    } else if (date < cursor) {
      break
    }
  }
  return streak
}

function getLast7Days(today: string): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - i)
    days.push(format(d, 'yyyy-MM-dd'))
  }
  return days
}

function formatDueDate(dateStr: string): string {
  return format(new Date(dateStr + 'T12:00:00'), 'MMM d')
}

function computeGoalProgress(goal: Goal): number {
  if (goal.target_value == null) return 0
  const current = goal.current_value ?? 0
  const start = goal.start_value ?? 0
  const target = goal.target_value
  if (goal.direction === 'descending') {
    if (start <= target) return 0
    const pct = ((start - current) / (start - target)) * 100
    return Math.max(0, Math.min(100, Math.round(pct)))
  }
  // ascending
  const denom = target - start
  if (denom <= 0) return current >= target ? 100 : 0
  const pct = ((current - start) / denom) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

export default function GoalsClient({ initialData, today }: Props) {
  const queryClient = useQueryClient()

  useEffect(() => {
    queryClient.setQueryData(['goals'], initialData)
  }, [queryClient, initialData])

  const { data } = useGoalsData()
  const { goals, habitLogs } = data ?? initialData

  const createGoal = useCreateGoal()
  const updateGoal = useUpdateGoal()
  const deleteGoal = useDeleteGoal()
  const logHabit = useLogHabit()
  const unlogHabit = useUnlogHabit()

  // Add sheet state
  const [showAdd, setShowAdd] = useState(false)
  const [addStep, setAddStep] = useState<1 | 2>(1)
  const [addType, setAddType] = useState<GoalType | null>(null)
  const [addTitle, setAddTitle] = useState('')
  const [addDesc, setAddDesc] = useState('')
  const [addTarget, setAddTarget] = useState('')
  const [addCurrent, setAddCurrent] = useState('')
  const [addDirection, setAddDirection] = useState<GoalDirection>('ascending')
  const [addUnit, setAddUnit] = useState('')
  const [addDueDate, setAddDueDate] = useState('')

  // Delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Completed section toggle
  const [showCompleted, setShowCompleted] = useState(false)

  // Numeric inline edit
  const [editingValueId, setEditingValueId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  // Coach
  const [coachText, setCoachText] = useState('')
  const [coachStreaming, setCoachStreaming] = useState(false)

  const habits = goals.filter(g => g.type === 'habit' && !g.completed_at)
  const oneoffs = goals.filter(g => g.type === 'oneoff' && !g.completed_at)
  const numerics = goals.filter(g => g.type === 'numeric' && !g.completed_at)
  const completed = goals.filter(g => !!g.completed_at)

  function resetAddSheet() {
    setAddStep(1)
    setAddType(null)
    setAddTitle('')
    setAddDesc('')
    setAddTarget('')
    setAddCurrent('')
    setAddDirection('ascending')
    setAddUnit('')
    setAddDueDate('')
  }

  function openAdd() {
    resetAddSheet()
    setShowAdd(true)
  }

  function closeAdd() {
    setShowAdd(false)
    resetAddSheet()
  }

  function selectType(type: GoalType) {
    setAddType(type)
    setAddStep(2)
  }

  async function handleSave() {
    if (!addType || !addTitle.trim()) return

    await createGoal.mutateAsync({
      type: addType,
      title: addTitle.trim(),
      description: addDesc.trim() || undefined,
      target_value: addTarget ? parseFloat(addTarget) : undefined,
      current_value: addType === 'numeric' && addCurrent ? parseFloat(addCurrent) : undefined,
      direction: addType === 'numeric' ? addDirection : undefined,
      unit: addUnit.trim() || undefined,
      due_date: addDueDate || undefined,
    })
    closeAdd()
  }

  async function toggleHabit(goal: Goal) {
    const loggedToday = habitLogs.some(l => l.goal_id === goal.id && l.date === today)
    if (loggedToday) {
      unlogHabit.mutate(goal.id)
    } else {
      logHabit.mutate(goal.id)
    }
  }

  async function completeOneoff(goal: Goal) {
    if (goal.completed_at) return
    updateGoal.mutate({ id: goal.id, completed_at: new Date().toISOString() })
  }

  function startEditNumeric(goal: Goal) {
    setEditingValueId(goal.id)
    setEditingValue(String(goal.current_value ?? 0))
  }

  async function saveNumericValue(goal: Goal) {
    const val = parseFloat(editingValue)
    if (isNaN(val) || val < 0) {
      setEditingValueId(null)
      return
    }
    const updates: Parameters<typeof updateGoal.mutate>[0] = { id: goal.id, current_value: val }
    if (goal.target_value != null) {
      const reached =
        goal.direction === 'descending' ? val <= goal.target_value : val >= goal.target_value
      if (reached) updates.completed_at = new Date().toISOString()
    }
    updateGoal.mutate(updates)
    setEditingValueId(null)
  }

  async function streamCoach() {
    setCoachStreaming(true)
    setCoachText('')
    try {
      const res = await fetch('/api/goals/coach', { method: 'POST' })
      if (!res.ok || !res.body) {
        setCoachText('Something went wrong. Try again.')
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        setCoachText(prev => prev + decoder.decode(value))
      }
    } finally {
      setCoachStreaming(false)
    }
  }

  return (
    <main className="min-h-screen px-6 pb-24 pt-14">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Goals</h1>
        <button
          onClick={openAdd}
          className="flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-black active:opacity-80"
        >
          + Add
        </button>
      </div>

      {/* AI Coach */}
      <div className="mb-8">
        <button
          onClick={streamCoach}
          disabled={coachStreaming}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-zinc-900 text-sm font-medium text-zinc-300 disabled:opacity-60 active:opacity-80"
        >
          {coachStreaming ? 'Thinking…' : 'Get coach feedback'}
        </button>
        {coachText && (
          <p className="mt-3 text-sm leading-relaxed text-zinc-300">{coachText}</p>
        )}
      </div>

      {/* Empty state */}
      {goals.length === 0 && (
        <p className="text-zinc-500">No goals yet. Add your first one.</p>
      )}

      {/* Habits */}
      {habits.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Habits
          </h2>
          <div className="flex flex-col gap-3">
            {habits.map(goal => {
              const loggedToday = habitLogs.some(l => l.goal_id === goal.id && l.date === today)
              const streak = computeStreak(goal.id, habitLogs, today)
              const last7 = getLast7Days(today)
              const logSet = new Set(habitLogs.filter(l => l.goal_id === goal.id).map(l => l.date))
              return (
                <div key={goal.id} className="relative rounded-xl bg-zinc-900 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => toggleHabit(goal)}
                      className={`h-6 w-6 flex-shrink-0 rounded-full border-2 transition-colors ${
                        loggedToday
                          ? 'border-white bg-white'
                          : 'border-zinc-600 bg-transparent'
                      }`}
                    />
                    <span className="flex-1 font-semibold text-white">{goal.title}</span>
                    {streak > 0 && (
                      <span className="text-sm font-bold text-orange-400">🔥 {streak}</span>
                    )}
                    <button
                      onClick={() => setConfirmDeleteId(goal.id)}
                      className="ml-1 text-lg text-zinc-600 active:text-zinc-400"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2.5 flex gap-1.5 pl-9">
                    {last7.map(day => (
                      <div
                        key={day}
                        className={`h-2 w-2 rounded-full ${logSet.has(day) ? 'bg-white' : 'bg-zinc-700'}`}
                      />
                    ))}
                  </div>
                  {goal.description && (
                    <p className="mt-2 pl-9 text-sm text-zinc-500">{goal.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* One-off goals */}
      {oneoffs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Goals
          </h2>
          <div className="flex flex-col gap-3">
            {oneoffs.map(goal => (
              <div key={goal.id} className="relative rounded-xl bg-zinc-900 px-5 py-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => completeOneoff(goal)}
                    className="h-6 w-6 flex-shrink-0 rounded-full border-2 border-zinc-600 bg-transparent transition-colors active:border-white"
                  />
                  <span className="flex-1 font-semibold text-white">{goal.title}</span>
                  {goal.due_date && (
                    <span className="text-sm text-zinc-500">{formatDueDate(goal.due_date)}</span>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(goal.id)}
                    className="ml-1 text-lg text-zinc-600 active:text-zinc-400"
                  >
                    ×
                  </button>
                </div>
                {goal.description && (
                  <p className="mt-2 pl-9 text-sm text-zinc-500">{goal.description}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Numeric targets */}
      {numerics.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Targets
          </h2>
          <div className="flex flex-col gap-3">
            {numerics.map(goal => {
              const pct = computeGoalProgress(goal)
              const isEditing = editingValueId === goal.id
              return (
                <div
                  key={goal.id}
                  className="relative rounded-xl bg-zinc-900 px-5 py-4"
                  onClick={() => !isEditing && startEditNumeric(goal)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{goal.title}</span>
                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={editingValue}
                            onFocus={e => e.target.select()} onChange={e => setEditingValue(e.target.value)}
                            onClick={e => e.stopPropagation()}
                            className="w-20 rounded-lg bg-zinc-800 px-2 py-1 text-right text-sm text-white focus:outline-none"
                            autoFocus
                          />
                          <button
                            onClick={e => { e.stopPropagation(); saveNumericValue(goal) }}
                            className="text-sm font-medium text-white active:opacity-70"
                          >
                            ✓
                          </button>
                        </>
                      ) : (
                        <span className="text-sm text-zinc-400">
                          {goal.current_value ?? 0}{goal.unit ? ' ' + goal.unit : ''} / {goal.target_value}{goal.unit ? ' ' + goal.unit : ''}
                        </span>
                      )}
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmDeleteId(goal.id) }}
                        className="ml-1 text-lg text-zinc-600 active:text-zinc-400"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-white transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {goal.description && (
                    <p className="mt-2 text-sm text-zinc-500">{goal.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Completed */}
      {completed.length > 0 && (
        <section className="mb-8">
          <button
            onClick={() => setShowCompleted(v => !v)}
            className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-600 active:text-zinc-400"
          >
            {showCompleted ? `Hide completed (${completed.length})` : `Show ${completed.length} completed`}
          </button>
          {showCompleted && (
            <div className="flex flex-col gap-3">
              {completed.map(goal => (
                <div key={goal.id} className="relative flex items-center gap-3 rounded-xl bg-zinc-900/50 px-5 py-4">
                  <div className="h-6 w-6 flex-shrink-0 rounded-full bg-zinc-700" />
                  <span className="flex-1 font-semibold text-zinc-500 line-through">{goal.title}</span>
                  <button
                    onClick={() => setConfirmDeleteId(goal.id)}
                    className="text-lg text-zinc-700 active:text-zinc-500"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Delete confirm modal */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 pb-10"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="mx-4 w-full max-w-sm rounded-2xl bg-zinc-900 p-6"
            onClick={e => e.stopPropagation()}
          >
            <p className="mb-1 text-base font-semibold">Delete goal?</p>
            <p className="mb-6 text-sm text-zinc-400">This can't be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
              >
                Cancel
              </button>
              <button
                onClick={() =>
                  deleteGoal.mutate(confirmDeleteId, {
                    onSuccess: () => setConfirmDeleteId(null),
                  })
                }
                disabled={deleteGoal.isPending}
                className="flex h-12 flex-1 items-center justify-center rounded-xl bg-red-600 text-sm font-semibold text-white disabled:opacity-50 active:opacity-80"
              >
                {deleteGoal.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add goal sheet */}
      {showAdd && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
          onClick={closeAdd}
        >
          <div
            className="mx-4 mb-6 w-full max-w-sm rounded-2xl bg-zinc-900 p-6"
            onClick={e => e.stopPropagation()}
          >
            {addStep === 1 ? (
              <>
                <p className="mb-6 text-lg font-semibold">What kind of goal?</p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => selectType('habit')}
                    className="w-full rounded-xl bg-zinc-800 px-5 py-4 text-left active:opacity-80"
                  >
                    <p className="font-semibold text-white">🔁 Habit</p>
                    <p className="mt-0.5 text-sm text-zinc-500">Something you do every day</p>
                  </button>
                  <button
                    onClick={() => selectType('oneoff')}
                    className="w-full rounded-xl bg-zinc-800 px-5 py-4 text-left active:opacity-80"
                  >
                    <p className="font-semibold text-white">✅ Goal</p>
                    <p className="mt-0.5 text-sm text-zinc-500">Something you want to finish</p>
                  </button>
                  <button
                    onClick={() => selectType('numeric')}
                    className="w-full rounded-xl bg-zinc-800 px-5 py-4 text-left active:opacity-80"
                  >
                    <p className="font-semibold text-white">📈 Target</p>
                    <p className="mt-0.5 text-sm text-zinc-500">A number you want to reach</p>
                  </button>
                </div>
                <button
                  onClick={closeAdd}
                  className="mt-4 flex h-12 w-full items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-zinc-400 active:opacity-80"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <p className="mb-6 text-lg font-semibold">
                  {addType === 'habit' ? '🔁 New Habit' : addType === 'oneoff' ? '✅ New Goal' : '📈 New Target'}
                </p>
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    placeholder="Title"
                    value={addTitle}
                    onChange={e => setAddTitle(e.target.value)}
                    className="w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={addDesc}
                    onChange={e => setAddDesc(e.target.value)}
                    className="w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                  />
                  {addType === 'oneoff' && (
                    <input
                      type="date"
                      value={addDueDate}
                      onChange={e => setAddDueDate(e.target.value)}
                      className="w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white focus:outline-none"
                    />
                  )}
                  {addType === 'numeric' && (
                    <>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAddDirection('ascending')}
                          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium active:opacity-80 ${
                            addDirection === 'ascending'
                              ? 'bg-white text-black'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          Going up ↗
                        </button>
                        <button
                          type="button"
                          onClick={() => setAddDirection('descending')}
                          className={`flex-1 rounded-xl px-4 py-3 text-sm font-medium active:opacity-80 ${
                            addDirection === 'descending'
                              ? 'bg-white text-black'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          Going down ↘
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={addDirection === 'descending' ? 'Current (e.g. 175)' : 'Current (e.g. 0)'}
                          value={addCurrent}
                          onFocus={e => e.target.select()} onChange={e => setAddCurrent(e.target.value)}
                          className="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                        />
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={addDirection === 'descending' ? 'Target (e.g. 155)' : 'Target (e.g. 225)'}
                          value={addTarget}
                          onFocus={e => e.target.select()} onChange={e => setAddTarget(e.target.value)}
                          className="flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Unit (e.g. lbs)"
                        value={addUnit}
                        onChange={e => setAddUnit(e.target.value)}
                        className="w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none"
                      />
                    </>
                  )}
                </div>
                <div className="mt-6 flex gap-3">
                  <button
                    onClick={closeAdd}
                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-sm font-medium text-white active:opacity-80"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={!addTitle.trim() || createGoal.isPending}
                    className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white text-sm font-semibold text-black disabled:opacity-40 active:opacity-80"
                  >
                    {createGoal.isPending ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
