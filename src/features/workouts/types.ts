import { z } from 'zod'

export interface Workout {
  id: string
  user_id: string
  name: string | null
  completed_at: string | null
  created_at: string
}

export interface Exercise {
  id: string
  workout_id: string
  name: string
  order_index: number
  created_at: string
}

export interface WorkoutSet {
  id: string
  exercise_id: string
  reps: number | null
  weight_lbs: number | null
  rpe: number | null
  completed: boolean
  order_index: number
  created_at: string
}

export interface WorkoutCoachResponse {
  id: string
  workout_id: string
  response_text: string
  created_at: string
}

export interface DailyCheckin {
  id: string
  user_id: string
  date: string
  morning_planned_training: boolean | null
  morning_intent: string | null
  evening_actual_training: boolean | null
  evening_reflection: string | null
  created_at: string
}

export type ExerciseWithSets = Exercise & { sets: WorkoutSet[] }
export type WorkoutWithExercises = Workout & { exercises: ExerciseWithSets[] }

export const MorningCheckinSchema = z.object({
  planned: z.boolean(),
  intent: z.string().max(500).optional(),
})

export const EveningCheckinSchema = z.object({
  trained: z.boolean(),
  reflection: z.string().max(500).optional(),
})

export const SetInputSchema = z.object({
  reps: z.number().int().min(0).max(9999).nullable(),
  weight_lbs: z.number().min(0).max(9999).nullable(),
  rpe: z.number().int().min(1).max(10).nullable(),
})

export type MorningCheckinInput = z.infer<typeof MorningCheckinSchema>
export type EveningCheckinInput = z.infer<typeof EveningCheckinSchema>
export type SetInput = z.infer<typeof SetInputSchema>
