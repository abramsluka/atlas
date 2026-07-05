import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { SupplementLog, TimeSlot } from './types'

export function useCreateSupplement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      name: string
      dose: string
      notes?: string | null
      times: TimeSlot[]
      running_low: boolean
      order_index?: number
    }) => {
      const res = await fetch('/api/health/supplements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create supplement')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'supplements'] }),
  })
}

export function useUpdateSupplement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      dose?: string | null
      notes?: string | null
      times?: TimeSlot[]
      running_low?: boolean
      supply_days_remaining?: number | null
      order_index?: number
      active?: boolean
    }) => {
      const { id, ...body } = input
      const res = await fetch(`/api/health/supplements/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update supplement')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'supplements'] }),
  })
}

export function useDeleteSupplement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/health/supplements/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to remove supplement')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'supplements'] }),
  })
}

// Optimistic updates on log/unlog so rapid taps across the stack register instantly.
// Rollback is surgical (undo only this mutation's row) so concurrent in-flight taps
// on other supplements survive an error on one of them. The refetch after settle is
// deferred until the last in-flight log mutation finishes, otherwise it would
// momentarily revert the optimistic rows of mutations still in the air.
export function useLogSupplementDose(today: string) {
  const qc = useQueryClient()
  const queryKey = ['health', 'supplement-logs', today]
  return useMutation({
    mutationKey: ['supplement-logs', today],
    mutationFn: async (input: { supplement_id: string; time_slot: TimeSlot }) => {
      const res = await fetch('/api/health/supplement-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, date: today }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to log dose')
      return res.json() as Promise<SupplementLog>
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey })
      const tempId = `optimistic-${input.supplement_id}-${input.time_slot}`
      const tempLog: SupplementLog = {
        id: tempId,
        user_id: '',
        supplement_id: input.supplement_id,
        date: today,
        time_slot: input.time_slot,
        taken_at: new Date().toISOString(),
      }
      qc.setQueryData<SupplementLog[]>(queryKey, (old = []) => [...old, tempLog])
      return { tempId }
    },
    onSuccess: (row, _input, ctx) => {
      qc.setQueryData<SupplementLog[]>(queryKey, (old = []) =>
        old.map(l => (l.id === ctx.tempId ? row : l))
      )
    },
    onError: (_err, _input, ctx) => {
      qc.setQueryData<SupplementLog[]>(queryKey, (old = []) =>
        old.filter(l => l.id !== ctx?.tempId)
      )
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['supplement-logs', today] }) === 1) {
        qc.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useUnlogSupplementDose(today: string) {
  const qc = useQueryClient()
  const queryKey = ['health', 'supplement-logs', today]
  return useMutation({
    mutationKey: ['supplement-logs', today],
    mutationFn: async (logId: string) => {
      const res = await fetch(`/api/health/supplement-logs/${logId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to remove log')
    },
    onMutate: async (logId) => {
      await qc.cancelQueries({ queryKey })
      const removed = qc.getQueryData<SupplementLog[]>(queryKey)?.find(l => l.id === logId)
      qc.setQueryData<SupplementLog[]>(queryKey, (old = []) => old.filter(l => l.id !== logId))
      return { removed }
    },
    onError: (_err, _logId, ctx) => {
      if (ctx?.removed) {
        qc.setQueryData<SupplementLog[]>(queryKey, (old = []) => [...old, ctx.removed!])
      }
    },
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['supplement-logs', today] }) === 1) {
        qc.invalidateQueries({ queryKey })
      }
    },
  })
}

export function useLogWater(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (amount_oz: number) => {
      const res = await fetch('/api/health/water', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, amount_oz }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to log water')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'water', today] }),
  })
}

export function useDeleteWaterLog(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/health/water/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to delete water log')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'water', today] }),
  })
}

export function useUpdateHealthProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: Partial<Omit<import('./types').HealthProfile, 'user_id' | 'updated_at'>>) => {
      const res = await fetch('/api/health/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to update profile')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'profile'] }),
  })
}

export function useLogCaffeine(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { source: string; amount_mg: number; logged_at?: string }) => {
      const res = await fetch('/api/health/caffeine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, date: today }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to log caffeine')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'caffeine', today] }),
  })
}

export function useDeleteCaffeineLog(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/health/caffeine/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to delete caffeine log')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'caffeine', today] }),
  })
}
