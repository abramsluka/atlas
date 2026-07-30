import { useQuery } from '@tanstack/react-query'
import type { DayPlanData, JournalEntry } from './types'

// Today's morning plan for the Home card. Seeded from the server render but
// immediately stale (initialDataUpdatedAt: 0) so it revalidates on mount —
// coming back from the journal always shows the freshest plan without a reload.
export function useDayPlan(initial?: DayPlanData | null) {
  return useQuery({
    queryKey: ['home', 'day-plan'],
    queryFn: async (): Promise<DayPlanData | null> => {
      const res = await fetch('/api/home/day-plan')
      if (!res.ok) throw new Error('Failed to load day plan')
      const j = await res.json()
      return j?.entryId ? { entryId: j.entryId, plan: j.plan ?? [] } : null
    },
    ...(initial !== undefined
      ? { initialData: initial, initialDataUpdatedAt: 0 }
      : {}),
  })
}

export function useJournalEntries() {
  return useQuery({
    queryKey: ['journal'],
    queryFn: async (): Promise<JournalEntry[]> => {
      const res = await fetch('/api/journal')
      if (!res.ok) throw new Error('Failed to load journal entries')
      return res.json()
    },
  })
}

export function useJournalEntry(id: string) {
  return useQuery({
    queryKey: ['journal', id],
    queryFn: async (): Promise<JournalEntry> => {
      const res = await fetch(`/api/journal/${id}`)
      if (!res.ok) throw new Error('Failed to load journal entry')
      return res.json()
    },
  })
}
