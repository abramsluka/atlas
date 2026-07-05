import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import type { DailyCheckin } from './types'

export function useTodayCheckin(today: string) {
  return useQuery({
    queryKey: ['checkin', today],
    queryFn: async (): Promise<DailyCheckin | null> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('daily_checkins')
        .select('*')
        .eq('date', today)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
