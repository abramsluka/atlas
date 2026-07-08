import { z } from 'zod'

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  audio_path?: string | null
  audio_url?: string | null  // signed, attached on read
}

export type EntryKind = 'morning' | 'night'

export interface PlanItem {
  id: string      // stable; crypto.randomUUID() at creation
  text: string    // one action, short
  done: boolean
}

export interface JournalEntry {
  id: string
  user_id: string
  date: string
  title: string | null
  body: string
  mood: number | null
  kind: EntryKind
  plan: PlanItem[]
  ai_reflection: string | null
  conversation: ConversationMessage[]
  audio_path: string | null
  audio_transcript: string | null
  audio_url?: string | null  // signed, attached on read
  created_at: string
  updated_at: string
}

export const PlanItemSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  done: z.boolean(),
})

// body may be empty for voice-only entries
export const CreateEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().max(200).optional(),
  body: z.string().max(10000).default(''),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  kind: z.enum(['morning', 'night']).default('night'),
  plan: z.array(PlanItemSchema).default([]),
})

export const UpdateEntrySchema = z.object({
  title: z.string().max(200).optional(),
  body: z.string().max(10000).optional(),
  mood: z.number().int().min(1).max(5).nullable().optional(),
  kind: z.enum(['morning', 'night']).optional(),
  plan: z.array(PlanItemSchema).optional(),
})

// z.input: fields with schema defaults (body, kind, plan) stay optional for callers
export type CreateEntryInput = z.input<typeof CreateEntrySchema>
export type UpdateEntryInput = z.infer<typeof UpdateEntrySchema>
