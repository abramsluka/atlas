import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HabitView, ToggleInput } from './types'

// Edit a habit's weekly goal (X times/week). Optimistic on perWeek.
export function useUpdateGoal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, perWeek }: { id: string; perWeek: number }) => {
      const res = await fetch(`/api/habits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perWeek }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Goal update failed (${res.status})`)
      }
      return res.json()
    },
    onMutate: async ({ id, perWeek }) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      qc.setQueryData<HabitView[]>(['habits'], (old) =>
        old?.map((h) => (h.id === id ? { ...h, perWeek } : h))
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

// Log or reset today for every manual habit at once.
export function useLogAll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, completed }: { date: string; completed: boolean }) => {
      const res = await fetch('/api/habits/log-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, completed }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Log all failed (${res.status})`)
      }
      return res.json()
    },
    onMutate: async ({ date, completed }) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      qc.setQueryData<HabitView[]>(['habits'], (old) =>
        old?.map((h) => {
          if (h.kind !== 'manual') return h
          const day = h.week.find((d) => d.date === date)
          if (!day || day.done === completed || day.future) return h
          return {
            ...h,
            week: h.week.map((d) => (d.date === date ? { ...d, done: completed } : d)),
            weeklyDone: h.weeklyDone + (completed ? 1 : -1),
          }
        })
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

// Optimistic tick: flip the day and nudge the weekly count instantly, then
// invalidate on settle so the true weeks-streak comes back from the server.
export function useToggleHabit() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, date, completed }: ToggleInput) => {
      const res = await fetch(`/api/habits/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, completed }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Toggle failed (${res.status})`)
      }
      return res.json()
    },
    onMutate: async ({ id, date, completed }) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      qc.setQueryData<HabitView[]>(['habits'], (old) =>
        old?.map((h) => {
          if (h.id !== id) return h
          const changed = h.week.some((d) => d.date === date && d.done !== completed)
          if (!changed) return h
          return {
            ...h,
            week: h.week.map((d) => (d.date === date ? { ...d, done: completed } : d)),
            weeklyDone: h.weeklyDone + (completed ? 1 : -1),
          }
        })
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['habits'] })
    },
  })
}
