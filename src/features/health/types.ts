export type TimeSlot = 'morning' | 'lunch' | 'evening' | 'anytime'

export interface Supplement {
  id: string
  user_id: string
  name: string
  dose: string | null
  notes: string | null
  times: TimeSlot[]
  running_low: boolean
  supply_days_remaining: number | null
  order_index: number
  active: boolean
  created_at: string
}

export interface SupplementLog {
  id: string
  user_id: string
  supplement_id: string
  date: string
  time_slot: TimeSlot
  taken_at: string
}

export interface WaterLog {
  id: string
  user_id: string
  date: string
  amount_oz: number
  logged_at: string
}

export interface SubstanceEntry {
  id: string
  name: string
  cat: string
  unit: string
  mlPerUnit: number
  defaultDose: number
  dose: number
  note: string
}

export interface HealthProfile {
  user_id: string
  weight_lbs: number | null
  daily_water_target_oz: number | null
  age: number | null
  sex: 'm' | 'f' | 'o' | null
  height_cm: number | null
  activity_hrs_per_week: number
  caffeine_mg_per_day: number
  water_unit: 'bottle' | 'glass' | 'oz' | 'ml'
  bottle_ml: number
  glass_ml: number
  weight_unit: 'lb' | 'kg'
  substances: SubstanceEntry[]
  target_weight_lbs: number | null
  cut_pace: 'slow' | 'moderate' | 'aggressive' | null
  daily_calorie_target: number | null
  daily_protein_target_g: number | null
  daily_carbs_target_g: number | null
  target_reasoning: string | null
  target_calc_weight_lbs: number | null
  target_calculated_at: string | null
  linked_target_goal_id: string | null
  updated_at: string
}

export interface CaffeineLog {
  id: string
  user_id: string
  date: string
  source: string
  amount_mg: number
  logged_at: string
}

export interface WearableToken {
  user_id: string
  provider: 'oura' | 'whoop'
  access_token: string
  refresh_token: string
  expires_at: string
}

export interface OuraData {
  sleep?: {
    score: number | null
    total_sleep_duration: number | null
    average_hrv: number | null
    deep_sleep_duration: number | null
    rem_sleep_duration: number | null
    latency: number | null
    efficiency: number | null
    resting_heart_rate: number | null
  }
  readiness?: {
    score: number | null
    temperature_deviation: number | null
  }
  activity?: {
    steps: number | null
    active_calories: number | null
    total_calories: number | null
  }
}

export interface OuraHistoryPoint {
  date: string
  readiness: number | null
  sleep_score: number | null
  hrv: number | null
}

export interface WhoopData {
  recovery?: {
    score: number | null
    hrv_rmssd_milli: number | null
  }
  cycle?: {
    strain: number | null
    kilojoule: number | null
  }
  sleep?: {
    duration_seconds: number | null
  }
}
