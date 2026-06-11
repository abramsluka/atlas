import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Jot, JotSynthesis, WeeklyReport } from './types'

export function useCreateJot() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (content: string): Promise<Jot> => {
      const res = await fetch('/api/mentor/jots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!res.ok) throw new Error('Failed to create jot')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jots'] })
    },
  })
}

export function useGenerateWeeklyReport() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<WeeklyReport> => {
      const res = await fetch('/api/mentor/weekly-report', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to generate report')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-reports'] })
    },
  })
}

export function useRunSynthesis() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (): Promise<JotSynthesis | { skipped: boolean; reason: string }> => {
      const res = await fetch('/api/mentor/synthesize', { method: 'POST' })
      if (!res.ok) throw new Error('Failed to run synthesis')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['latest-synthesis'] })
    },
  })
}
