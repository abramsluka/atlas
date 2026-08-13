import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GymConfig, GymExercise, GymLog, GymSession, BodyWeight, BodyMeasurement, ProgressPhoto } from './types'

export function useSaveGymConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (config: Partial<GymConfig>) => {
      const res = await fetch('/api/gym/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error('Failed to save config')
      return res.json() as Promise<GymConfig>
    },
    onSuccess: (data) => qc.setQueryData(['gym-config'], data),
  })
}

export function useCreateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ex: Omit<GymExercise, 'id' | 'user_id'>) => {
      const res = await fetch('/api/gym/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ex),
      })
      if (!res.ok) throw new Error('Failed to create exercise')
      return res.json() as Promise<GymExercise>
    },
    onSuccess: (data) => {
      qc.setQueryData<GymExercise[]>(['gym-exercises'], (old = []) => [...old, data])
    },
  })
}

export function useUpdateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<GymExercise> & { id: string }) => {
      const res = await fetch(`/api/gym/exercises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update exercise')
      return res.json() as Promise<GymExercise>
    },
    onSuccess: (data) => {
      qc.setQueryData<GymExercise[]>(['gym-exercises'], (old = []) =>
        old.map(e => e.id === data.id ? data : e)
      )
    },
  })
}

export function useReorderExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await fetch('/api/gym/exercises/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error('Failed to reorder exercises')
      return res.json()
    },
    onMutate: async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: ['gym-exercises'] })
      const prev = qc.getQueryData<GymExercise[]>(['gym-exercises'])
      if (prev) {
        const byId = new Map(prev.map(e => [e.id, e]))
        const next = ids
          .map((id, i) => { const e = byId.get(id); return e ? { ...e, order_index: i } : null })
          .filter((e): e is GymExercise => e !== null)
        qc.setQueryData<GymExercise[]>(['gym-exercises'], next)
      }
      return { prev }
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(['gym-exercises'], ctx.prev)
    },
  })
}

export function useDeleteExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/gym/exercises/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete exercise')
    },
    onSuccess: (_, id) => {
      qc.setQueryData<GymExercise[]>(['gym-exercises'], (old = []) =>
        old.filter(e => e.id !== id)
      )
      qc.removeQueries({ queryKey: ['gym-logs', id] })
    },
  })
}

export function useLogSet() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (log: {
      exercise_id: string; weight: number; reps: number
      // today-only swap metadata — set when the exercise is swapped for the day
      performed_exercise?: string | null; performed_library_id?: string | null
    }) => {
      const res = await fetch('/api/gym/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      })
      if (!res.ok) throw new Error('Failed to log set')
      return res.json() as Promise<GymLog>
    },
    onSuccess: (data) => {
      // Only patch caches that were actually fetched. Seeding ['gym-logs', id]
      // from `old = []` here would leave the History sheet (staleTime 30s, the
      // sole consumer of this key) serving just this session's sets as the whole
      // history — the flaky "history didn't load". Absent → the sheet fetches the
      // full history fresh on open.
      qc.setQueryData<GymLog[]>(['gym-logs', data.exercise_id], (old) => old ? [...old, data] : undefined)
      qc.setQueryData<GymLog[]>(['gym-logs-all'], (old) => old ? [...old, data] : undefined)
      // Session start/end is server-derived from the logs — refetch it.
      qc.invalidateQueries({ queryKey: ['gym-sessions'] })
    },
  })
}

export function useDeleteLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, exerciseId }: { id: string; exerciseId: string }) => {
      const res = await fetch(`/api/gym/logs/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete log')
      return exerciseId
    },
    onSuccess: (exerciseId, { id }) => {
      // Same guard as useLogSet: only touch caches already fetched, so a delete
      // can't seed an empty ['gym-logs', id] that the History sheet would then
      // show as "No history yet" for the 30s stale window.
      qc.setQueryData<GymLog[]>(['gym-logs', exerciseId], (old) =>
        old ? old.filter(l => l.id !== id) : undefined
      )
      qc.setQueryData<GymLog[]>(['gym-logs-all'], (old) =>
        old ? old.filter(l => l.id !== id) : undefined
      )
      qc.invalidateQueries({ queryKey: ['gym-sessions'] })
    },
  })
}

export function useUploadPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await fetch('/api/gym/photos', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Failed to upload photo')
      return res.json() as Promise<ProgressPhoto>
    },
    onSuccess: (data) => {
      qc.setQueryData<ProgressPhoto[]>(['progress-photos'], (old = []) =>
        [...old, data].sort((a, b) => b.date.localeCompare(a.date))
      )
    },
  })
}

export function useDeletePhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/gym/photos/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete photo')
    },
    onSuccess: (_, id) => {
      qc.setQueryData<ProgressPhoto[]>(['progress-photos'], (old = []) =>
        old.filter(p => p.id !== id)
      )
    },
  })
}

export function useLogBodyMeasurement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (m: { date_key: string; neck_in: number; waist_in: number; hip_in?: number | null; bf_pct: number }) => {
      const res = await fetch('/api/gym/measurements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(m),
      })
      if (!res.ok) throw new Error('Failed to save measurement')
      return res.json() as Promise<BodyMeasurement>
    },
    onSuccess: (data) => {
      qc.setQueryData<BodyMeasurement[]>(['body-measurements'], (old = []) => {
        const filtered = old.filter(m => m.date_key !== data.date_key)
        return [...filtered, data].sort((a, b) => a.date_key.localeCompare(b.date_key))
      })
    },
  })
}

export function useLogBodyWeight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date_key, weight }: { date_key: string; weight: number }) => {
      const res = await fetch('/api/gym/bodyweight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_key, weight }),
      })
      if (!res.ok) throw new Error('Failed to log body weight')
      return res.json() as Promise<BodyWeight>
    },
    onSuccess: (data) => {
      qc.setQueryData<BodyWeight[]>(['body-weights'], (old = []) => {
        const filtered = old.filter(w => w.date_key !== data.date_key)
        return [...filtered, data].sort((a, b) => a.date_key.localeCompare(b.date_key))
      })
      // Keep health profile weight_lbs in sync so water target reflects latest weight
      fetch('/api/health/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weight_lbs: data.weight }),
      }).then(() => qc.invalidateQueries({ queryKey: ['health', 'profile'] })).catch(() => {})
    },
  })
}

// Finish Workout / un-finish. Marking the day done is what banks the training
// streak and tells the AI coaches to stop treating him as mid-session, so it has
// to reach the server — localStorage alone only ever informed one device.
export function useFinishWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date_key, finished }: { date_key: string; finished: boolean }) => {
      const res = await fetch('/api/gym/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_key, finished }),
      })
      if (!res.ok) throw new Error('Failed to update workout session')
      return res.json() as Promise<GymSession>
    },
    onSuccess: (data) => {
      qc.setQueryData<GymSession[]>(['gym-sessions'], (old = []) =>
        old.some(s => s.date_key === data.date_key)
          ? old.map(s => (s.date_key === data.date_key ? data : s))
          : [data, ...old],
      )
      // The home streak strip reads finished_at through its own fetch and
      // re-pulls on focus, so it picks this up on the way back to Home.
    },
  })
}
