import { z } from 'zod'

export type GoalType = 'habit' | 'oneoff' | 'numeric'
export type GoalDirection = 'ascending' | 'descending'

export interface Goal {
  id: string
  user_id: string
  type: GoalType
  title: string
  description: string | null
  target_value: number | null
  current_value: number | null
  start_value: number | null
  direction: GoalDirection
  unit: string | null
  due_date: string | null
  completed_at: string | null
  order_index: number
  created_at: string
  updated_at: string
}

export interface HabitLog {
  id: string
  user_id: string
  goal_id: string
  date: string
  created_at: string
}

export interface GoalsData {
  goals: Goal[]
  habitLogs: HabitLog[]
}

export const CreateGoalSchema = z.object({
  type: z.enum(['habit', 'oneoff', 'numeric']),
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  target_value: z.number().positive().optional(),
  current_value: z.number().min(0).optional(),
  direction: z.enum(['ascending', 'descending']).optional(),
  unit: z.string().max(50).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const UpdateGoalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
  target_value: z.number().positive().nullable().optional(),
  current_value: z.number().min(0).nullable().optional(),
  start_value: z.number().min(0).nullable().optional(),
  direction: z.enum(['ascending', 'descending']).optional(),
  unit: z.string().max(50).nullable().optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completed_at: z.string().nullable().optional(),
})

export type CreateGoalInput = z.infer<typeof CreateGoalSchema>
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>
