import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import type {
  DailyCheckin,
  WorkoutWithExercises,
  WorkoutCoachResponse,
} from './types'

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

export function useWorkouts() {
  return useQuery({
    queryKey: ['workouts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<WorkoutWithExercises[]> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          *,
          exercises (
            *,
            sets (*)
          )
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as WorkoutWithExercises[]
    },
  })
}

export function useWorkout(id: string) {
  return useQuery({
    queryKey: ['workout', id],
    queryFn: async (): Promise<WorkoutWithExercises | null> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('workouts')
        .select(`
          *,
          exercises (
            *,
            sets (*)
          )
        `)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as WorkoutWithExercises | null
    },
  })
}

export function useCoachResponse(workoutId: string) {
  return useQuery({
    queryKey: ['coach-response', workoutId],
    queryFn: async (): Promise<WorkoutCoachResponse | null> => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('workout_coach_responses')
        .select('*')
        .eq('workout_id', workoutId)
        .maybeSingle()
      if (error) throw error
      return data
    },
  })
}
