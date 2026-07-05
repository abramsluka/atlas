import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import type { MorningCheckinInput, EveningCheckinInput } from './types'

export function useSaveMorningCheckin(today: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: MorningCheckinInput) => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const user = session.user

      const { data, error } = await supabase
        .from('daily_checkins')
        .upsert(
          {
            user_id: user.id,
            date: today,
            morning_planned_training: input.planned,
            morning_intent: input.intent ?? null,
          },
          { onConflict: 'user_id,date' }
        )
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin', today] })
    },
  })
}

export function useSaveEveningCheckin(today: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: EveningCheckinInput) => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not authenticated')
      const user = session.user

      const { data, error } = await supabase
        .from('daily_checkins')
        .upsert(
          {
            user_id: user.id,
            date: today,
            evening_actual_training: input.trained,
            evening_reflection: input.reflection ?? null,
          },
          { onConflict: 'user_id,date' }
        )
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checkin', today] })
    },
  })
}
