import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import { nextCalendarDate } from './energyModel'
import type {
  Supplement,
  SupplementLog,
  WaterLog,
  CaffeineLog,
  HealthProfile,
  OuraData,
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

// Logs the MCP tools also write (from Claude, outside this browser) poll every
// 30s while the tab is visible, so remote logs appear without a reload.
const REMOTE_WRITE_POLL = { refetchInterval: 30_000 } as const

export function useSupplementLogs(today: string, initialData?: SupplementLog[]) {
  return useQuery({
    queryKey: ['health', 'supplement-logs', today],
    initialData,
    ...REMOTE_WRITE_POLL,
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
    ...REMOTE_WRITE_POLL,
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
    ...REMOTE_WRITE_POLL,
    queryFn: async (): Promise<CaffeineLog[]> => {
      const supabase = createClient()
      // Two-date fetch: post-midnight doses may carry the next calendar date
      // (e.g. logged via MCP) but still belong to this energy day.
      const { data, error } = await supabase
        .from('caffeine_logs')
        .select('*')
        .in('date', [today, nextCalendarDate(today)])
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
    // Keep the last good value on a transient failure (Oura's API/DNS blips)
    // instead of returning null — a hiccup shouldn't blank the card to
    // "No data yet". Throwing lets TanStack Query retain prior data + retry.
    placeholderData: prev => prev,
    queryFn: async (): Promise<OuraData | null> => {
      const res = await fetch('/api/health/oura/data')
      if (!res.ok) throw new Error(`oura data ${res.status}`)
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

export interface AppleHealthStatus {
  daysOfData: number
  lastSync: string | null
  todaySteps: number | null
  latest: {
    date: string
    steps: number | null
    active_calories: number | null
    vo2_max: number | null
  } | null
}

// Apple Health status (steps, active energy, VO₂ max) synced via the Shortcuts
// bridge. Surfaces the latest synced day for the wearables card; latest is null
// when the user has never set up Apple Health sync.
export function useAppleHealth(today: string) {
  return useQuery<AppleHealthStatus>({
    queryKey: ['apple-status', today],
    queryFn: async (): Promise<AppleHealthStatus> => {
      const empty: AppleHealthStatus = { daysOfData: 0, lastSync: null, todaySteps: null, latest: null }
      const res = await fetch('/api/health/apple/status')
      if (!res.ok) return empty
      return res.json()
    },
    staleTime: 60_000,
    retry: false,
  })
}
