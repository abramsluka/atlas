import { useQuery } from '@tanstack/react-query'
import type { DebloatLog } from './types'

export function useDebloatLog(date: string) {
  return useQuery({
    queryKey: ['debloat-log', date],
    queryFn: async (): Promise<DebloatLog | null> => {
      const res = await fetch(`/api/debloat/log?date=${date}`)
      if (!res.ok) throw new Error('Failed to load debloat log')
      return res.json()
    },
  })
}

export function useDebloatHistory() {
  return useQuery({
    queryKey: ['debloat-history'],
    queryFn: async (): Promise<DebloatLog[]> => {
      const res = await fetch('/api/debloat/log?history=true')
      if (!res.ok) throw new Error('Failed to load debloat history')
      return res.json()
    },
  })
}
