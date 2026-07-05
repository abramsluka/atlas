import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import type {
  Supplement,
  SupplementLog,
  WaterLog,
  CaffeineLog,
  HealthProfile,
  OuraData,
  WhoopData,
} from './types'

export function useSupplements(initialData?: Supplement[]) {
  return useQuery({
    queryKey: ['health', 'supplements'],
    initialData,
    queryFn: async (): Promise<Supplement[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('supplements')
        .select('*')
        .eq('active', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as Supplement[]
    },
  })
}

export function useSupplementLogs(today: string, initialData?: SupplementLog[]) {
  return useQuery({
    queryKey: ['health', 'supplement-logs', today],
    initialData,
    queryFn: async (): Promise<SupplementLog[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('supplement_logs')
        .select('*')
        .eq('date', today)
      if (error) throw error
      return (data ?? []) as SupplementLog[]
    },
  })
}

export function useWaterLogs(today: string, initialData?: WaterLog[]) {
  return useQuery({
    queryKey: ['health', 'water', today],
    initialData,
    queryFn: async (): Promise<WaterLog[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('water_logs')
        .select('*')
        .eq('date', today)
        .order('logged_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as WaterLog[]
    },
  })
}

export function useCaffeineLogs(today: string, initialData?: CaffeineLog[]) {
  return useQuery({
    queryKey: ['health', 'caffeine', today],
    initialData,
    queryFn: async (): Promise<CaffeineLog[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('caffeine_logs')
        .select('*')
        .eq('date', today)
        .order('logged_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as CaffeineLog[]
    },
  })
}

export function useHealthProfile(initialData?: HealthProfile | null) {
  return useQuery({
    queryKey: ['health', 'profile'],
    initialData: initialData ?? undefined,
    queryFn: async (): Promise<HealthProfile | null> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('health_profile')
        .select('*')
        .maybeSingle()
      if (error) throw error
      return data as HealthProfile | null
    },
  })
}

export function useWaterHistory() {
  return useQuery({
    queryKey: ['health', 'water', 'history'],
    queryFn: async (): Promise<{ date: string; total_oz: number }[]> => {
      const res = await fetch('/api/health/water/history')
      if (!res.ok) throw new Error('Failed to fetch water history')
      return res.json()
    },
  })
}

export function useOuraData(today: string, enabled: boolean, initialData?: OuraData | null) {
  return useQuery({
    queryKey: ['health', 'oura', today],
    enabled,
    initialData: initialData !== undefined ? initialData ?? undefined : undefined,
    queryFn: async (): Promise<OuraData | null> => {
      const res = await fetch('/api/health/oura/data')
      if (!res.ok) return null
      return res.json()
    },
  })
}

export function useOuraHistory(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['health', 'oura', 'history', days],
    enabled,
    queryFn: async (): Promise<import('./types').OuraHistoryPoint[]> => {
      const res = await fetch(`/api/health/oura/history?days=${days}`)
      if (!res.ok) return []
      return res.json()
    },
  })
}

export function useWhoopData(today: string, enabled: boolean, initialData?: WhoopData | null) {
  return useQuery({
    queryKey: ['health', 'whoop', today],
    enabled,
    initialData: initialData !== undefined ? initialData ?? undefined : undefined,
    queryFn: async (): Promise<WhoopData | null> => {
      const res = await fetch('/api/health/whoop/data')
      if (res.status === 401) throw new Error('auth')
      if (!res.ok) return null
      return res.json()
    },
    retry: false,
  })
}

// Today's Apple Health steps (synced via the Shortcuts bridge). Backend-only
// data surfaced as a single tile; null when nothing synced today.
export function useAppleSteps(today: string) {
  return useQuery({
    queryKey: ['apple-status', today],
    queryFn: async (): Promise<{ todaySteps: number | null }> => {
      const res = await fetch('/api/health/apple/status')
      if (!res.ok) return { todaySteps: null }
      return res.json()
    },
    staleTime: 60_000,
    retry: false,
  })
}
