import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FoodLog } from './types'

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

export function useUpdateFoodLog() {
  const qc = useQueryClient()
  return useMutation<
    FoodLog,
    Error,
    { id: string; date: string; updates: Partial<Pick<FoodLog, 'item_name' | 'calories' | 'protein_g' | 'carbs_g' | 'notes'>> }
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
