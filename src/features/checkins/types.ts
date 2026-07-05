import { z } from 'zod'

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

export const MorningCheckinSchema = z.object({
  planned: z.boolean(),
  intent: z.string().max(500).optional(),
})

export const EveningCheckinSchema = z.object({
  trained: z.boolean(),
  reflection: z.string().max(500).optional(),
})

export type MorningCheckinInput = z.infer<typeof MorningCheckinSchema>
export type EveningCheckinInput = z.infer<typeof EveningCheckinSchema>
