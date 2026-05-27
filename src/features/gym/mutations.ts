import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { GymConfig, GymExercise, GymLog, BodyWeight, ProgressPhoto } from './types'

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
    mutationFn: async (log: { exercise_id: string; weight: number; reps: number }) => {
      const res = await fetch('/api/gym/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(log),
      })
      if (!res.ok) throw new Error('Failed to log set')
      return res.json() as Promise<GymLog>
    },
    onSuccess: (data) => {
      qc.setQueryData<GymLog[]>(['gym-logs', data.exercise_id], (old = []) => [...old, data])
      qc.setQueryData<GymLog[]>(['gym-logs-all'], (old = []) => [...old, data])
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
      qc.setQueryData<GymLog[]>(['gym-logs', exerciseId], (old = []) =>
        old.filter(l => l.id !== id)
      )
      qc.setQueryData<GymLog[]>(['gym-logs-all'], (old = []) =>
        old.filter(l => l.id !== id)
      )
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
    },
  })
}
