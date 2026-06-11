export type FoodSource = 'photo' | 'text' | 'drink' | 'barcode'

export interface FoodLog {
  id: string
  user_id: string
  date: string
  storage_path: string | null
  item_name: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  confidence: 'low' | 'medium' | 'high' | null
  ai_raw: unknown
  notes: string | null
  source: FoodSource
  barcode: string | null
  volume_oz: number | null
  refine_status: 'open' | 'done' | null
  user_description: string | null
  taken_at: string
  created_at: string
  updated_at: string
  photo_url?: string | null
}

export interface FoodEstimate {
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number | null
  confidence: 'low' | 'medium' | 'high'
  notes: string
}

export interface PhotoRefineQuestion {
  question: string
  reasoning: string
  options: string[]
  calorie_delta?: number
}

export interface PhotoRefineAnswer {
  question: string
  answer: string
}

export type PhotoRefineResponse =
  | { status: 'question'; question: PhotoRefineQuestion }
  | {
      status: 'final'
      id: string
      calories: number
      protein_g: number
      carbs_g: number
      fat_g: number | null
      confidence: string
      notes: string
      refine_status: 'done'
    }

export interface FoodItem {
  id: string
  user_id: string
  name: string
  brand: string | null
  barcode: string | null
  source: Exclude<FoodSource, 'photo'>
  calories: number
  protein_g: number
  carbs_g: number
  portion_desc: string
  volume_oz: number | null
  is_hydrating: boolean
  use_count: number
  last_used_at: string
  created_at: string
}

// ── Estimation wizard (Add food / Quick drink) ──

export interface WizardAnswer {
  question: string
  answer: string
  skipped?: boolean
}

export interface EstimateFinal {
  status: 'final'
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  confidence: 'low' | 'medium' | 'high'
  notes: string
  portion_desc: string
  volume_oz: number | null
  is_hydrating: boolean
}

export interface EstimateQuestion {
  status: 'question'
  question: string
  options: string[]
  step: number
}

export type EstimateResponse = EstimateFinal | EstimateQuestion

// ── Barcode lookup ──

export interface BarcodeMacros {
  calories: number
  protein_g: number
  carbs_g: number
}

export type BarcodeLookup =
  | {
      found: true
      name: string
      brand: string | null
      per_100g: BarcodeMacros
      per_serving: BarcodeMacros | null
      serving_size: string | null
      serving_grams: number | null
      package_grams: number | null
    }
  | { found: false }

export interface DailyTotals {
  calories: number
  protein_g: number
  carbs_g: number
  mealCount: number
}

export interface DailyFoodSummary {
  date: string
  calories: number
  protein_g: number
  carbs_g: number
  meal_count: number
}
