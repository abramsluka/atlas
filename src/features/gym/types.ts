export interface GymEntry {
  id: string
  name: string
}

export interface DayEntry {
  id: string
  name: string
}

export interface SplitAnchor {
  date: string  // YYYY-MM-DD
  index: number
}

export interface GymConfig {
  id?: string
  user_id?: string
  gyms: GymEntry[]
  days: DayEntry[]
  split_rotation: string[]
  split_anchor: SplitAnchor | null
  units: 'lbs' | 'kg'
  upgrade_at_reps: number
  upgrade_at_reps_auto?: boolean
  celebrate_pr?: boolean       // full-screen New Best burst on PR (default true)
  show_next_target?: boolean   // "beat your best" card in the history sheet (default true)
}

export interface GymExercise {
  id: string
  user_id?: string
  name: string
  gym_id: string   // gym id or 'both'
  day_ids: string[]
  bodyweight: boolean
  start_weight: number
  rep_min: number
  rep_max: number
  step: number
  order_index: number
  library_id?: string | null
}

// Slim exercise_library index row — fetched once per session for autocomplete
export interface ExerciseLibraryEntry {
  id: string
  name: string
  short_name: string | null   // compact rail display name; full name stays in `name`
  aliases: string[]
  primary_muscles: string[]
  equipment: string | null    // in the slim index for SwapSheet's different-equipment ranking
  bodyweight: boolean
  default_goal: 'strength' | 'hypertrophy' | 'endurance'
  rep_min: number
  rep_max: number
  step: number
  popularity: number
  start_weight_ratio: number | null
  female_factor: number | null
}

export interface ExerciseLibraryDetail extends ExerciseLibraryEntry {
  category: string | null
  equipment: string | null
  level: string | null
  mechanic: string | null
  force: string | null
  secondary_muscles: string[]
  instructions: string[]
  image_urls: string[]  // public bucket URLs, no signing
}

export interface GymLog {
  id: string
  user_id?: string
  exercise_id: string
  weight: number
  reps: number
  logged_at: string  // ISO
  // Today-only swap: the movement actually performed (travel-day substitute).
  // NULL = the slot's own exercise. Swapped sets are excluded from progression math.
  performed_exercise?: string | null
  performed_library_id?: string | null
}

export interface GymSession {
  id: string
  user_id?: string
  date_key: string   // LA calendar day, YYYY-MM-DD
  started_at: string // ISO
  ended_at: string   // ISO
}

export interface BodyWeight {
  id: string
  user_id?: string
  date_key: string  // YYYY-MM-DD
  weight: number
  created_at?: string
}

export interface BodyMeasurement {
  id: string
  user_id?: string
  date_key: string  // YYYY-MM-DD
  neck_in: number
  waist_in: number
  hip_in?: number | null
  bf_pct: number
  created_at?: string
}

export interface ProgressPhoto {
  id: string
  user_id?: string
  date: string  // YYYY-MM-DD
  weight?: number | null
  weight_unit?: string
  storage_path: string
  created_at?: string
  url: string  // signed URL, 60-min expiry
}

export type PrescriptionAction = 'INCREASE' | 'HOLD' | 'REPEAT' | 'DROP' | 'DELOAD'

export interface Prescription {
  action: PrescriptionAction
  reason: string
  nextWeight?: number
}
