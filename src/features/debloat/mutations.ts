import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { DebloatLog } from './types'

interface UpsertPayload {
  date: string
  bloat_level?: number | null
  checklist?: Record<string, boolean>
  notes?: string | null
}

export function useUpsertDebloatLog() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UpsertPayload): Promise<DebloatLog> => {
      const res = await fetch('/api/debloat/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Failed to save log')
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['debloat-log', data.date] })
      queryClient.invalidateQueries({ queryKey: ['debloat-history'] })
    },
  })
}
