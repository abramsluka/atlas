export interface FoodLog {
  id: string
  user_id: string
  date: string
  storage_path: string
  item_name: string
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  confidence: 'low' | 'medium' | 'high' | null
  ai_raw: unknown
  notes: string | null
  taken_at: string
  created_at: string
  updated_at: string
  photo_url?: string
}

export interface FoodEstimate {
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  confidence: 'low' | 'medium' | 'high'
  notes: string
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
