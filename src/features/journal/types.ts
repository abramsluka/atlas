import { z } from 'zod'

export interface JournalEntry {
  id: string
  user_id: string
  date: string
  title: string | null
  body: string
  mood: number | null
  ai_reflection: string | null
  created_at: string
  updated_at: string
}

export const CreateEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(10000),
  mood: z.number().int().min(1).max(5).nullable().optional(),
})

export const UpdateEntrySchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().min(1).max(10000).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
})

export type CreateEntryInput = z.infer<typeof CreateEntrySchema>
export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>
