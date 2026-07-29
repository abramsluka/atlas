import { useQuery } from '@tanstack/react-query'
import type { ProfileFactWithSource } from '@/lib/profile/types'

export function useProfileFacts() {
  return useQuery({
    queryKey: ['profile-facts'],
    queryFn: async (): Promise<{ facts: ProfileFactWithSource[] }> => {
      const res = await fetch('/api/profile/facts')
      if (!res.ok) throw new Error('Failed to fetch profile facts')
      return res.json()
    },
  })
}
