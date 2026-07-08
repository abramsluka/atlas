import { useQuery } from '@tanstack/react-query'
import type { HabitView, HabitHistoryWeek } from './types'

export function useHabits(initial?: HabitView[]) {
  return useQuery({
    queryKey: ['habits'],
    queryFn: async (): Promise<HabitView[]> => {
      const res = await fetch('/api/habits')
      if (!res.ok) throw new Error('Failed to load habits')
      const json = await res.json()
      return json.habits as HabitView[]
    },
    initialData: initial,
  })
}

// Lazy — only fetched when the History pager is opened (enabled).
export function useHabitHistory(enabled: boolean) {
  return useQuery({
    queryKey: ['habits', 'history'],
    queryFn: async (): Promise<HabitHistoryWeek[]> => {
      const res = await fetch('/api/habits/history')
      if (!res.ok) throw new Error('Failed to load history')
      const json = await res.json()
      return json.weeks as HabitHistoryWeek[]
    },
    enabled,
  })
}
