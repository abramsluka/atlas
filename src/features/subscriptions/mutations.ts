import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateSubscriptionPayload, UpdateSubscriptionPayload, ImportedSubscription } from './types'
import { checkNoApiKey, checkAiLimit } from '@/lib/apiKeyError'

export function useCreateSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateSubscriptionPayload) => {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Failed to create subscription')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  })
}

export function useUpdateSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: UpdateSubscriptionPayload }) => {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) throw new Error('Failed to update subscription')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  })
}

export function useAnalyzeSubscriptionScreenshot() {
  return useMutation({
    mutationFn: async (payload: { imageBase64: string; mediaType: string }) => {
      const res = await fetch('/api/subscriptions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const keyErr = await checkNoApiKey(res)
        if (keyErr) throw keyErr
        const limitErr = await checkAiLimit(res)
        if (limitErr) throw limitErr
        throw new Error('Failed to read screenshot')
      }
      return res.json() as Promise<{ subscriptions: ImportedSubscription[] }>
    },
  })
}

export function useDeleteSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete subscription')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  })
}
