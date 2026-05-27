import { useQuery } from '@tanstack/react-query'
import type { Subscription } from './types'

export function useSubscriptions() {
  return useQuery<Subscription[]>({
    queryKey: ['subscriptions'],
    queryFn: async () => {
      const res = await fetch('/api/subscriptions')
      if (!res.ok) throw new Error('Failed to fetch subscriptions')
      return res.json()
    },
  })
}
