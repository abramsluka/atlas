import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TimeSlot } from './types'

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

export function useLogSupplementDose(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { supplement_id: string; time_slot: TimeSlot }) => {
      const res = await fetch('/api/health/supplement-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, date: today }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to log dose')
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'supplement-logs', today] }),
  })
}

export function useUnlogSupplementDose(today: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (logId: string) => {
      const res = await fetch(`/api/health/supplement-logs/${logId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to remove log')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health', 'supplement-logs', today] }),
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
