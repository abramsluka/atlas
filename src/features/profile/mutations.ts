import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { FactCategory, FactStatus } from '@/lib/profile/types'

export function useUpdateFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, content, status }: { id: string; content?: string; status?: Extract<FactStatus, 'active' | 'pinned'> }) => {
      const res = await fetch(`/api/profile/facts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, status }),
      })
      if (!res.ok) throw new Error('Failed to update fact')
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile-facts'] }) },
  })
}

export function useDeleteFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/profile/facts/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete fact')
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile-facts'] }) },
  })
}

export function useCreateFact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ category, content }: { category: FactCategory; content: string }) => {
      const res = await fetch('/api/profile/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, content }),
      })
      if (!res.ok) throw new Error('Failed to create fact')
      return res.json()
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['profile-facts'] }) },
  })
}
