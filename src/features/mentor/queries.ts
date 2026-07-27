import { useQuery } from '@tanstack/react-query'
import { checkNoApiKey, checkAiLimit } from '@/lib/apiKeyError'
import type { Jot, JotSynthesis, MentorContext, WeeklyReport, ActivitySnapshot } from './types'

export function useJots() {
  return useQuery({
    queryKey: ['jots'],
    queryFn: async (): Promise<{ jots: Jot[]; total_count: number }> => {
      const res = await fetch('/api/mentor/jots')
      if (!res.ok) throw new Error('Failed to fetch jots')
      return res.json()
    },
  })
}

export function useMentorContext() {
  return useQuery({
    queryKey: ['mentor-context'],
    queryFn: async (): Promise<MentorContext> => {
      const res = await fetch('/api/mentor/context')
      if (!res.ok) throw new Error('Failed to fetch mentor context')
      return res.json()
    },
  })
}

export function useMentorPrompts() {
  return useQuery({
    queryKey: ['mentor-prompts'],
    queryFn: async (): Promise<{ prompts: string[] }> => {
      const res = await fetch('/api/mentor/prompts')
      if (!res.ok) throw (await checkNoApiKey(res)) ?? (await checkAiLimit(res)) ?? new Error('Failed to fetch prompts')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })
}

export function useWeeklyReports() {
  return useQuery({
    queryKey: ['weekly-reports'],
    queryFn: async (): Promise<WeeklyReport[]> => {
      const res = await fetch('/api/mentor/weekly-reports')
      if (!res.ok) throw new Error('Failed to fetch reports')
      return res.json()
    },
  })
}

export function useLatestSynthesis() {
  return useQuery({
    queryKey: ['latest-synthesis'],
    queryFn: async (): Promise<JotSynthesis | null> => {
      const res = await fetch('/api/mentor/synthesize')
      if (!res.ok) throw new Error('Failed to fetch synthesis')
      return res.json()
    },
  })
}

export function useActivitySnapshot() {
  return useQuery({
    queryKey: ['activity-snapshot'],
    queryFn: async (): Promise<ActivitySnapshot> => {
      const res = await fetch('/api/home/activity-snapshot')
      if (!res.ok) throw new Error('Failed to fetch activity snapshot')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}
