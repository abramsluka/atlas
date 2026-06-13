import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FoodLog, EstimateResponse, EstimateFinal, WizardAnswer, PhotoRefineResponse } from './types'

export function useLogFood() {
  const qc = useQueryClient()
  return useMutation<FoodLog, Error, FormData>({
    mutationFn: async (formData) => {
      const res = await fetch('/api/health/food', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to log food')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['food-logs', data.date] })
    },
  })
}

export function useEstimateFood() {
  return useMutation<
    EstimateResponse,
    Error,
    { description: string; kind: 'food' | 'drink'; answers: WizardAnswer[] }
  >({
    mutationFn: async (body) => {
      const res = await fetch('/api/health/food/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to estimate')
      }
      return res.json()
    },
  })
}

export type ManualLogInput = Omit<EstimateFinal, 'status'> & {
  source: 'text' | 'drink' | 'barcode'
  barcode?: string | null
  brand?: string | null
}

export function useLogManualFood() {
  const qc = useQueryClient()
  return useMutation<FoodLog & { water_logged: boolean }, Error, ManualLogInput>({
    mutationFn: async (body) => {
      const res = await fetch('/api/health/food/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to log food')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['food-logs', data.date] })
      qc.invalidateQueries({ queryKey: ['food-items'] })
      if (data.water_logged) {
        qc.invalidateQueries({ queryKey: ['health', 'water'] })
      }
    },
  })
}

export function useRepeatFoodLog() {
  const qc = useQueryClient()
  return useMutation<FoodLog & { water_logged: boolean }, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/health/food/${id}/repeat`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to add meal to today')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['food-logs', data.date] })
      qc.invalidateQueries({ queryKey: ['food-history'] })
      if (data.water_logged) {
        qc.invalidateQueries({ queryKey: ['health', 'water'] })
      }
    },
  })
}

export function useUpdateFoodLog() {
  const qc = useQueryClient()
  return useMutation<
    FoodLog,
    Error,
    { id: string; date: string; updates: Partial<Pick<FoodLog, 'item_name' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'notes' | 'refine_status' | 'user_description'>> }
  >({
    mutationFn: async ({ id, updates }) => {
      const res = await fetch(`/api/health/food/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update food log')
      return res.json()
    },
    onSuccess: (_, { date }) => {
      qc.invalidateQueries({ queryKey: ['food-logs', date] })
    },
  })
}

export function useDeleteFoodLog() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string; date: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/health/food/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete food log')
    },
    onSuccess: (_, { date }) => {
      qc.invalidateQueries({ queryKey: ['food-logs', date] })
    },
  })
}

export function useRefinePhotoMeal() {
  const qc = useQueryClient()
  return useMutation<
    PhotoRefineResponse,
    Error,
    { id: string; date: string; question: string; answer: string; rewindTo?: number }
  >({
    mutationFn: async ({ id, question, answer, rewindTo }) => {
      const res = await fetch(`/api/health/food/${id}/refine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, answer, ...(rewindTo != null ? { rewindTo } : {}) }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to refine')
      }
      return res.json()
    },
    onSuccess: (data, { id, date }) => {
      if (data.status === 'final') {
        qc.setQueryData(['food-logs', date], (old: FoodLog[] | undefined) => {
          if (!old) return old
          return old.map(m =>
            m.id === id
              ? {
                  ...m,
                  calories: data.calories,
                  protein_g: data.protein_g,
                  carbs_g: data.carbs_g,
                  fat_g: data.fat_g,
                  confidence: data.confidence as FoodLog['confidence'],
                  notes: data.notes,
                  refine_status: 'done' as const,
                }
              : m,
          )
        })
      }
    },
  })
}

export function useFavoriteFoodLog() {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean; favorited: boolean }, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/health/food/${id}/favorite`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to favorite')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['food-items'] })
    },
  })
}

export function useCalculateCalorieTarget() {
  const qc = useQueryClient()
  return useMutation<
    { daily_calories: number; protein_g: number; carbs_g: number; reasoning: string },
    Error,
    void
  >({
    mutationFn: async () => {
      const res = await fetch('/api/health/calorie-target/calculate', { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to calculate target')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['health-profile'] })
    },
  })
}
