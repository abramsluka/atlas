import { useQuery } from '@tanstack/react-query'

export interface OrbChips {
  morning: string[]
  midday: string[]
  evening: string[]
}

// Learned open-chips for the Orb (distilled from orb_commands, cached
// server-side). null until the user has enough history.
export function useOrbChips(enabled: boolean) {
  return useQuery<{ chips: OrbChips | null; computedAt: string | null }>({
    queryKey: ['orb-chips'],
    queryFn: async () => {
      const res = await fetch('/api/assistant/chips')
      if (!res.ok) throw new Error('Failed to fetch orb chips')
      return res.json()
    },
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
