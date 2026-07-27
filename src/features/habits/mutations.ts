import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { HabitView, HabitHistoryWeek, ToggleInput } from './types'

// Create a manual habit. No optimistic insert — a HabitView needs a server-built
// week array, so we just refetch on settle.
export function useCreateHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; emoji: string; perWeek: number }) => {
      const res = await fetch('/api/habits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Create failed (${res.status})`)
      }
      return res.json()
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

// Edit a habit's name / emoji / weekly goal. Optimistic on all three.
export function useUpdateHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; name?: string; emoji?: string; perWeek?: number }) => {
      const res = await fetch(`/api/habits/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Update failed (${res.status})`)
      }
      return res.json()
    },
    onMutate: async ({ id, name, emoji, perWeek }) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      qc.setQueryData<HabitView[]>(['habits'], (old) =>
        old?.map((h) => (h.id === id ? {
          ...h,
          ...(name !== undefined ? { name } : {}),
          ...(emoji !== undefined ? { emoji } : {}),
          ...(perWeek !== undefined ? { perWeek } : {}),
        } : h))
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

// Remove (archive) a habit. Optimistically drops it from the list.
export function useDeleteHabit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/habits/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        throw new Error(b.error ?? `Delete failed (${res.status})`)
      }
      return res.json()
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      qc.setQueryData<HabitView[]>(['habits'], (old) => old?.filter((h) => h.id !== id))
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

// Persist a new order. Optimistically reorders the cached list by id.
export function useReorderHabits() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/habits/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('Failed to reorder habits')
      return res.json()
    },
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: ['habits'] })
      const prev = qc.getQueryData<HabitView[]>(['habits'])
      if (prev) {
        const byId = new Map(prev.map((h) => [h.id, h]))
        const next = ids
          .map((id, i) => { const h = byId.get(id); return h ? { ...h, order: i } : null })
          .filter((h): h is HabitView => h !== null)
        qc.setQueryData<HabitView[]>(['habits'], next)
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev) },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['habits'] }) },
  })
}

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
      const prevHistory = qc.getQueryData<HabitHistoryWeek[]>(['habits', 'history'])
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
      // The Week view reads from the history cache — flip it here too so the dot
      // updates instantly instead of waiting for the settle refetch.
      qc.setQueryData<HabitHistoryWeek[]>(['habits', 'history'], (old) =>
        old?.map((wk) => {
          const di = wk.dates.indexOf(date)
          if (di === -1) return wk
          return {
            ...wk,
            habits: wk.habits.map((h) => {
              if (h.id !== id || h.done[di] === completed) return h
              const done = h.done.map((v, i) => (i === di ? completed : v))
              const count = h.count + (completed ? 1 : -1)
              return { ...h, done, count, hit: count >= h.perWeek }
            }),
          }
        })
      )
      return { prev, prevHistory }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['habits'], ctx.prev)
      if (ctx?.prevHistory) qc.setQueryData(['habits', 'history'], ctx.prevHistory)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['habits'] })
    },
  })
}
