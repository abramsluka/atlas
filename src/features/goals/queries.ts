import { useQuery } from '@tanstack/react-query'
import type { GoalsData } from './types'

export function useGoalsData() {
  return useQuery({
    queryKey: ['goals'],
    queryFn: async (): Promise<GoalsData> => {
      const res = await fetch('/api/goals')
      if (!res.ok) throw new Error('Failed to load goals')
      return res.json()
    },
  })
}
