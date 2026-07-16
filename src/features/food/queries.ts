import { useQuery } from '@tanstack/react-query'
import type {
  FoodLog,
  FoodItem,
  DailyFoodSummary,
  FoodCoachMessage,
  SavedMeal,
  UserIngredient,
} from './types'
import { rolledDate } from './date'

export function useFoodLogs(date?: string) {
  const d = date ?? rolledDate()
  return useQuery<FoodLog[]>({
    queryKey: ['food-logs', d],
    queryFn: async () => {
      const res = await fetch(`/api/health/food?date=${d}`)
      if (!res.ok) throw new Error('Failed to fetch food logs')
      return res.json()
    },
  })
}

export function useFoodItems() {
  return useQuery<FoodItem[]>({
    queryKey: ['food-items'],
    queryFn: async () => {
      const res = await fetch('/api/health/food/items')
      if (!res.ok) throw new Error('Failed to fetch food items')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useUserIngredients() {
  return useQuery<UserIngredient[]>({
    queryKey: ['user-ingredients'],
    queryFn: async () => {
      const res = await fetch('/api/health/food/ingredients')
      if (!res.ok) throw new Error('Failed to fetch ingredients')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useSavedMeals() {
  return useQuery<SavedMeal[]>({
    queryKey: ['saved-meals'],
    queryFn: async () => {
      const res = await fetch('/api/health/food/meals')
      if (!res.ok) throw new Error('Failed to fetch saved meals')
      return res.json()
    },
    staleTime: 60_000,
  })
}

export function useFoodCoachMessages(date: string) {
  return useQuery<FoodCoachMessage[]>({
    queryKey: ['food-coach', date],
    queryFn: async () => {
      const res = await fetch(`/api/health/food/coach?date=${date}`)
      if (!res.ok) throw new Error('Failed to fetch coach messages')
      return res.json()
    },
    staleTime: 30_000,
  })
}

export function useFoodHistory(days = 14) {
  return useQuery<DailyFoodSummary[]>({
    queryKey: ['food-history', days],
    queryFn: async () => {
      const res = await fetch(`/api/health/food/history?days=${days}`)
      if (!res.ok) throw new Error('Failed to fetch food history')
      return res.json()
    },
  })
}
