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
      queryClient.invalidateQueries({ queryKey: ['home', 'day-plan'] })
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
      queryClient.invalidateQueries({ queryKey: ['home', 'day-plan'] })
    },
  })
}

// Single-item plan ops (check / add / remove) against a morning entry.
// The server does the read-modify-write, so callers only name the change.
export type PlanItemOp =
  | { entryId: string; op: 'check'; item_id: string; done: boolean }
  | { entryId: string; op: 'add'; text: string; after_item_id?: string; at_start?: boolean }
  | { entryId: string; op: 'remove'; item_id: string }

export function usePlanItemOp() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ entryId, ...op }: PlanItemOp) => {
      const res = await fetch(`/api/journal/${entryId}/plan/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(op),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Failed to update plan (${res.status})`)
      }
      return res.json()
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      queryClient.invalidateQueries({ queryKey: ['journal', vars.entryId] })
      queryClient.invalidateQueries({ queryKey: ['home', 'day-plan'] })
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
      queryClient.invalidateQueries({ queryKey: ['home', 'day-plan'] })
    },
  })
}
