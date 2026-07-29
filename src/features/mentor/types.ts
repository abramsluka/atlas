export interface Jot {
  id: string
  user_id: string
  content: string
  created_at: string
}

export interface JotSynthesis {
  id: string
  user_id: string
  synthesis_text: string
  jot_count: number
  created_at: string
}

export interface MentorContext {
  primary_goal: string | null
  goal_last_comment: string | null
}

export interface WeeklyReport {
  id: string
  week_of: string
  report_text: string
  created_at: string
}

export interface ActivitySnapshot {
  gym: number
  health: number
  journal: number
  mentor: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  id: string
  actions?: import('@/features/assistant/actions').ProposedAction[]
  clarify?: { question: string; options: string[] } | null
}
