import { useQuery } from '@tanstack/react-query'
import type { FoodLog, DailyFoodSummary } from './types'
import { format, subHours } from 'date-fns'

function rolledDate(): string {
  const now = new Date()
  const adjusted = now.getHours() < 6 ? subHours(now, 6) : now
  return format(adjusted, 'yyyy-MM-dd')
}

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
