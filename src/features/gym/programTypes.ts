export type ProgramGoal = 'strength' | 'hypertrophy' | 'recomp'
export type ProgramStructure = 'overlay' | 'standalone'
export type ProgramStatus = 'active' | 'completed' | 'archived'
export type ProgramPhase = 'accumulation' | 'deload' | 'intensification' | 'peak'

// One prescribed movement in a session. Periodization only — no weight, the PO
// engine owns the bar weight. exercise_id links to an existing gym_exercise;
// is_new flags a movement the program wants to add (created on save).
export interface ProgramExercise {
  exercise_id: string | null
  name: string
  sets: number
  rep_min: number
  rep_max: number
  rpe: number | null
  notes: string | null
  is_new: boolean
}

export interface ProgramSession {
  id?: string
  week_number: number
  session_number: number
  label: string
  day_id: string | null            // overlay mode → gym_config.days[].id; null = standalone
  phase: ProgramPhase | null
  exercises: ProgramExercise[]
}

export interface TrainingProgram {
  id: string
  user_id?: string
  name: string
  goal: ProgramGoal
  duration_weeks: number
  days_per_week: number
  structure: ProgramStructure
  status: ProgramStatus
  start_date: string | null
  notes: string | null
  created_at?: string
}

// What /generate returns (not yet persisted) and what /save accepts.
export interface GeneratedProgram {
  name: string
  goal: ProgramGoal
  duration_weeks: number
  days_per_week: number
  structure: ProgramStructure
  notes: string | null
  sessions: ProgramSession[]
}

export interface GenerateProgramRequest {
  goal: ProgramGoal
  duration_weeks: number
  days_per_week: number
  structure: ProgramStructure
}

// Server returns the program + which week we're in + that week's sessions.
// The client picks "today's session" from weekSessions (it owns the split logic
// for overlay mode, and session order for standalone).
export interface ActiveProgramResponse {
  program: TrainingProgram
  currentWeek: number
  weekSessions: ProgramSession[]
}

// Full program detail — every session across every week.
export interface ProgramDetailResponse {
  program: TrainingProgram
  sessions: ProgramSession[]
}
