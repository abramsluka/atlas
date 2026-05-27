import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateEntryInput, JournalEntry, UpdateEntryInput } from './types'

export function useCreateEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: CreateEntryInput): Promise<JournalEntry> => {
      const res = await fetch('/api/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to create entry (${res.status})`)
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
    },
  })
}

export function useUpdateEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: UpdateEntryInput & { id: string }): Promise<JournalEntry> => {
      const res = await fetch(`/api/journal/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to update entry (${res.status})`)
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      queryClient.invalidateQueries({ queryKey: ['journal', data.id] })
    },
  })
}

export function useDeleteEntry() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to delete entry (${res.status})`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
    },
  })
}
