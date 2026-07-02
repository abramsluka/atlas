import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InsightsResponse } from '@/app/api/mentor/insights/route'

export function useInsights(enabled: boolean) {
  return useQuery<InsightsResponse>({
    queryKey: ['mentor-insights'],
    queryFn: async () => {
      const res = await fetch('/api/mentor/insights')
      if (!res.ok) throw new Error('Failed to load insights')
      return res.json()
    },
    enabled,          // lazy — only fetch once the Insights tab is opened
    staleTime: 5 * 60_000,
  })
}

export function usePinInsight() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ insight_id, pinned }: { insight_id: string; pinned: boolean }) => {
      const res = await fetch('/api/mentor/insights/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ insight_id, pinned }),
      })
      if (!res.ok) throw new Error('Failed to update pin')
      return res.json()
    },
    // Optimistically flip the pin in the cached insights response.
    onMutate: async ({ insight_id, pinned }) => {
      await qc.cancelQueries({ queryKey: ['mentor-insights'] })
      const prev = qc.getQueryData<InsightsResponse>(['mentor-insights'])
      if (prev) {
        const pinnedIds = pinned
          ? Array.from(new Set([...prev.pinnedIds, insight_id]))
          : prev.pinnedIds.filter(id => id !== insight_id)
        qc.setQueryData<InsightsResponse>(['mentor-insights'], { ...prev, pinnedIds })
      }
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['mentor-insights'], ctx.prev)
    },
  })
}
