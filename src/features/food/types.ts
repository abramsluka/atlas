export type FoodSource = 'photo' | 'text' | 'drink' | 'barcode' | 'meal'

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
  coach_feedback: string | null
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

export interface FoodCoachMessage {
  id: string
  user_id: string
  date: string
  role: 'user' | 'assistant'
  content: string
  chip_label: string | null
  is_summary: boolean
  created_at: string
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
  source: Exclude<FoodSource, 'photo' | 'meal'>
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
  caffeine_mg: number
}

export interface EstimateQuestion {
  status: 'question'
  question: string
  options: string[]
  step: number
  /** Why this detail matters — shown under the question, e.g. "Cooking oil could swing this ±120 kcal". */
  reasoning?: string
  /** Rough kcal range the answer could move the estimate. */
  calorie_delta?: number
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

// ── Meal builder ──

/** One ingredient row inside a composed meal. Snapshot — never a live FK, so
 *  library edits/deletes can't corrupt an already-saved meal or log. */
export interface MealIngredient {
  ref: string | null // bundled library slug or user_ingredients uuid
  name: string
  emoji: string | null
  grams: number // ml for liquids (treated 1:1)
  per100: { cal: number; protein: number; carbs: number }
  unit_name: string | null
  unit_grams: number | null
  liquid: boolean
  hydrating: boolean
  caffeine_per_100: number | null
}

export interface MealTotals {
  cal: number
  protein: number
  carbs: number
  grams: number
  volume_oz: number | null // hydrating liquid ml → fl oz
  caffeine_mg: number
}

export interface UserIngredient {
  id: string
  user_id: string
  name: string
  brand: string | null
  barcode: string | null
  cal_per_100: number
  protein_per_100: number
  carbs_per_100: number
  unit_name: string | null
  unit_grams: number | null
  liquid: boolean
  hydrating: boolean
  caffeine_per_100: number | null
  use_count: number
  last_used_at: string
  created_at: string
}

export interface SavedMeal {
  id: string
  user_id: string
  name: string
  emoji: string | null
  ingredients: MealIngredient[]
  calories: number
  protein_g: number
  carbs_g: number
  total_grams: number
  use_count: number
  last_used_at: string
  created_at: string
}

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
