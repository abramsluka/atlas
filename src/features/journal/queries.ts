import { useQuery } from '@tanstack/react-query'
import type { JournalEntry } from './types'

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
