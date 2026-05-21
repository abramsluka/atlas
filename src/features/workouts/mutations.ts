import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/browser'
import type { MorningCheckinInput, EveningCheckinInput } from './types'

export function useSaveMorningCheckin(today: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: MorningCheckinInput) => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

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
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

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

export function useCreateWorkout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('workouts')
        .insert({ user_id: user.id })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] })
    },
  })
}

export function useUpdateWorkoutName(workoutId: string) {
  return useMutation({
    mutationFn: async (name: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('workouts')
        .update({ name: name || null })
        .eq('id', workoutId)
      if (error) throw error
    },
  })
}

export function useFinishWorkout() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workoutId: string) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('workouts')
        .update({ completed_at: new Date().toISOString() })
        .eq('id', workoutId)
      if (error) throw error
      return workoutId
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workouts'] })
    },
  })
}

export function useAddExercise(workoutId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orderIndex: number) => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('exercises')
        .insert({ workout_id: workoutId, name: '', order_index: orderIndex })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] })
    },
  })
}

export function useUpdateExerciseName() {
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('exercises')
        .update({ name })
        .eq('id', id)
      if (error) throw error
    },
  })
}

export function useAddSet(workoutId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      exerciseId,
      orderIndex,
    }: {
      exerciseId: string
      orderIndex: number
    }) => {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('sets')
        .insert({
          exercise_id: exerciseId,
          order_index: orderIndex,
          completed: false,
        })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] })
    },
  })
}

export function useUpdateSet() {
  return useMutation({
    mutationFn: async ({
      id,
      reps,
      weight_lbs,
      rpe,
    }: {
      id: string
      reps: number | null
      weight_lbs: number | null
      rpe: number | null
    }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('sets')
        .update({ reps, weight_lbs, rpe })
        .eq('id', id)
      if (error) throw error
    },
  })
}

export function useToggleSetComplete(workoutId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      const supabase = createClient()
      const { error } = await supabase
        .from('sets')
        .update({ completed })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workout', workoutId] })
    },
  })
}
