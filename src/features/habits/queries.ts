import { useQuery } from '@tanstack/react-query'
import type { HabitView } from './types'

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
