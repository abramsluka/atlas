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
  water_unit: 'bottle' | 'glass'
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
  show_oura: boolean
  show_apple_watch: boolean
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
  provider: 'oura'
  access_token: string
  refresh_token: string
  expires_at: string
}

export interface OuraData {
  sleep?: {
    score: number | null
    // Days the score / session detail belong to (YYYY-MM-DD). A cache row
    // written before the morning ring sync carries the previous day's values;
    // the sync uses these to know the row is a stale snapshot, not today's.
    score_day?: string | null
    detail_day?: string | null
    total_sleep_duration: number | null
    average_hrv: number | null
    deep_sleep_duration: number | null
    rem_sleep_duration: number | null
    latency: number | null
    efficiency: number | null
    resting_heart_rate: number | null
    bedtime_end: string | null  // ISO 8601 — when the user woke up
  }
  readiness?: {
    score: number | null
    temperature_deviation: number | null
  }
  activity?: {
    steps: number | null
    active_calories: number | null
    total_calories: number | null
    // YYYY-MM-DD the steps/calories belong to. Activity is picked
    // latest-available (Oura finalizes it on a lag), so this may be yesterday;
    // the UI uses it to label non-today counts honestly.
    steps_day?: string | null
  }
  // Only present on provider='whoop' rows (normalized into this shape by
  // whoopSync). Nothing renders it yet; kept for a future strain tile.
  whoop?: {
    strain: number | null
  }
  // Only present on provider='fitbit' rows (fitbitSync). Fitbit's Web API has
  // no sleep or readiness score, so both are derived by Atlas from duration,
  // efficiency, stages, HRV and RHR baselines (formulas in
  // specs/health/FITBIT_INTEGRATION_SPEC.md). scores_estimated is what the
  // card reads to label them "est.".
  fitbit?: {
    scores_estimated: true
    log_type: 'stages' | 'classic' | null
    hrv_baseline: number | null
    rhr_baseline: number | null
  }
}

export interface OuraHistoryPoint {
  date: string
  readiness: number | null
  sleep_score: number | null
  hrv: number | null
}

