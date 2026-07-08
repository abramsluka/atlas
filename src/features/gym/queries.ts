import { useQuery } from '@tanstack/react-query'
import type { GymConfig, GymExercise, GymLog, GymSession, BodyWeight, BodyMeasurement, ProgressPhoto } from './types'

export function useGymConfig(initial?: GymConfig | null) {
  return useQuery<GymConfig>({
    queryKey: ['gym-config'],
    queryFn: async () => {
      const res = await fetch('/api/gym/config')
      if (!res.ok) throw new Error('Failed to fetch gym config')
      return res.json()
    },
    initialData: initial ?? undefined,
    staleTime: 60_000,
  })
}

export function useGymExercises(initial?: GymExercise[]) {
  return useQuery<GymExercise[]>({
    queryKey: ['gym-exercises'],
    queryFn: async () => {
      const res = await fetch('/api/gym/exercises')
      if (!res.ok) throw new Error('Failed to fetch exercises')
      return res.json()
    },
    initialData: initial,
    staleTime: 60_000,
  })
}

export function useGymLogs(exerciseId: string | null) {
  return useQuery<GymLog[]>({
    queryKey: ['gym-logs', exerciseId],
    queryFn: async () => {
      const res = await fetch(`/api/gym/logs?exercise_id=${exerciseId}`)
      if (!res.ok) throw new Error('Failed to fetch logs')
      return res.json()
    },
    enabled: !!exerciseId,
    staleTime: 30_000,
  })
}

export function useAllGymLogs() {
  return useQuery<GymLog[]>({
    queryKey: ['gym-logs-all'],
    queryFn: async () => {
      const res = await fetch('/api/gym/logs')
      if (!res.ok) throw new Error('Failed to fetch logs')
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useGymSessions() {
  return useQuery<GymSession[]>({
    queryKey: ['gym-sessions'],
    queryFn: async () => {
      const res = await fetch('/api/gym/sessions')
      if (!res.ok) throw new Error('Failed to fetch gym sessions')
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useProgressPhotos() {
  return useQuery<ProgressPhoto[]>({
    queryKey: ['progress-photos'],
    queryFn: async () => {
      const res = await fetch('/api/gym/photos')
      if (!res.ok) throw new Error('Failed to fetch progress photos')
      return res.json()
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useBodyMeasurements() {
  return useQuery<BodyMeasurement[]>({
    queryKey: ['body-measurements'],
    queryFn: async () => {
      const res = await fetch('/api/gym/measurements')
      if (!res.ok) throw new Error('Failed to fetch body measurements')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useBodyWeights(initial?: BodyWeight[]) {
  return useQuery<BodyWeight[]>({
    queryKey: ['body-weights'],
    queryFn: async () => {
      const res = await fetch('/api/gym/bodyweight')
      if (!res.ok) throw new Error('Failed to fetch body weights')
      return res.json()
    },
    initialData: initial,
    staleTime: 60_000,
  })
}
