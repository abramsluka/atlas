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
}

export interface GymExercise {
  id: string
  user_id?: string
  name: string
  gym_id: string   // gym id or 'both'
  day_id: string
  bodyweight: boolean
  start_weight: number
  rep_min: number
  rep_max: number
  step: number
  order_index: number
}

export interface GymLog {
  id: string
  user_id?: string
  exercise_id: string
  weight: number
  reps: number
  logged_at: string  // ISO
}

export interface BodyWeight {
  id: string
  user_id?: string
  date_key: string  // YYYY-MM-DD
  weight: number
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
