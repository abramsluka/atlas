import { useMutation, useQueryClient } from '@tanstack/react-query'
import { checkNoApiKey } from '@/lib/apiKeyError'
import type {
  FoodLog,
  EstimateResponse,
  EstimateFinal,
  WizardAnswer,
  PhotoRefineResponse,
  MealIngredient,
  SavedMeal,
  UserIngredient,
} from './types'

export function useLogFood() {
  const qc = useQueryClient()
  return useMutation<FoodLog, Error, FormData>({
    mutationFn: async (formData) => {
      const res = await fetch('/api/health/food', { method: 'POST', body: formData })
      if (!res.ok) {
        const noKey = await checkNoApiKey(res)
        if (noKey) throw noKey
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
        const noKey = await checkNoApiKey(res)
        if (noKey) throw noKey
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Failed to estimate')
      }
      return res.json()
    },
  })
}

export type ManualLogInput = Omit<EstimateFinal, 'status' | 'caffeine_mg'> & {
  source: 'text' | 'drink' | 'barcode'
  barcode?: string | null
  brand?: string | null
  // Only the drink wizard supplies this; caffeinated drinks also log a dose.
  caffeine_mg?: number
}

export function useLogManualFood() {
  const qc = useQueryClient()
  return useMutation<FoodLog & { water_logged: boolean; caffeine_logged: boolean }, Error, ManualLogInput>({
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
      if (data.caffeine_logged) {
        qc.invalidateQueries({ queryKey: ['health', 'caffeine'] })
      }
    },
  })
}

// ── Meal builder ──

export interface LogMealInput {
  name: string
  ingredients: MealIngredient[]
  saved_meal_id?: string | null
  save_as?: { name: string; emoji?: string | null } | null
}

export interface LogMealResult extends FoodLog {
  water_logged: boolean
  caffeine_logged: boolean
  caffeine_mg: number
  volume_oz: number | null
  saved_meal: SavedMeal | null
}

export function useLogMeal() {
  const qc = useQueryClient()
  return useMutation<LogMealResult, Error, LogMealInput>({
    mutationFn: async (body) => {
      const res = await fetch('/api/health/food/meals/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to log meal')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['food-logs', data.date] })
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
      qc.invalidateQueries({ queryKey: ['user-ingredients'] })
      if (data.water_logged) qc.invalidateQueries({ queryKey: ['health', 'water'] })
      if (data.caffeine_logged) qc.invalidateQueries({ queryKey: ['health', 'caffeine'] })
    },
  })
}

export interface CreateIngredientInput {
  name: string
  brand?: string | null
  barcode?: string | null
  cal_per_100: number
  protein_per_100: number
  carbs_per_100: number
  unit_name?: string | null
  unit_grams?: number | null
  liquid?: boolean
  hydrating?: boolean
  caffeine_per_100?: number | null
}

export function useCreateIngredient() {
  const qc = useQueryClient()
  return useMutation<UserIngredient, Error, CreateIngredientInput>({
    mutationFn: async (body) => {
      const res = await fetch('/api/health/food/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to save ingredient')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-ingredients'] })
    },
  })
}

export function useDeleteSavedMeal() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/health/food/meals/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete meal')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
    },
  })
}

export interface UpdateSavedMealInput {
  id: string
  name?: string
  emoji?: string | null
  ingredients?: MealIngredient[]
}

export function useUpdateSavedMeal() {
  const qc = useQueryClient()
  return useMutation<SavedMeal, Error, UpdateSavedMealInput>({
    mutationFn: async ({ id, ...updates }) => {
      const res = await fetch(`/api/health/food/meals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to update recipe')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['saved-meals'] })
    },
  })
}

export type UpdateIngredientInput = Partial<CreateIngredientInput> & { id: string }

export function useUpdateIngredient() {
  const qc = useQueryClient()
  return useMutation<UserIngredient, Error, UpdateIngredientInput>({
    mutationFn: async ({ id, ...updates }) => {
      const res = await fetch(`/api/health/food/ingredients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(typeof err.error === 'string' ? err.error : 'Failed to update food')
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-ingredients'] })
    },
  })
}

export function useDeleteIngredient() {
  const qc = useQueryClient()
  return useMutation<void, Error, { id: string }>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/health/food/ingredients/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete food')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-ingredients'] })
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
    onSuccess: (data, { id }) => {
      // Patch the edited row directly into every cached day-list (keyed by id,
      // not date) so the client-summed calorie/macro totals update instantly.
      // We don't lean on invalidate+refetch here: the caller's `date` isn't
      // guaranteed to match the meal's stored date key, and a refetch can be
      // served stale. `data` is the server's authoritative row; it has no
      // `photo_url` column, so the spread preserves the existing signed URL.
      qc.setQueriesData<FoodLog[]>({ queryKey: ['food-logs'] }, (old) =>
        old?.map((m) => (m.id === id ? { ...m, ...data } : m)),
      )
      // The 14-day sparkline is a server-summed aggregate — nothing else
      // refreshes it, so recompute it after an edit.
      qc.invalidateQueries({ queryKey: ['food-history'] })
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
    onSuccess: (_, { id }) => {
      // Drop the row from every cached day-list so the totals fall instantly,
      // regardless of which date key held it (see useUpdateFoodLog).
      qc.setQueriesData<FoodLog[]>({ queryKey: ['food-logs'] }, (old) =>
        old?.filter((m) => m.id !== id),
      )
      qc.invalidateQueries({ queryKey: ['food-history'] })
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
        const noKey = await checkNoApiKey(res)
        if (noKey) throw noKey
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
        const noKey = await checkNoApiKey(res)
        if (noKey) throw noKey
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
