import { z } from 'zod'

// Snapshot validation shared by the saved-meals and log-meal routes.
// per100 caps: pure oil ≈ 900 cal, isolate whey ≈ 90 protein, sugar = 100 carbs.
export const MealIngredientSchema = z.object({
  ref: z.string().max(80).nullable(),
  name: z.string().min(1).max(80),
  emoji: z.string().max(8).nullable(),
  grams: z.number().positive().max(10000),
  per100: z.object({
    cal: z.number().min(0).max(1000),
    protein: z.number().min(0).max(100),
    carbs: z.number().min(0).max(100),
  }),
  unit_name: z.string().max(24).nullable(),
  unit_grams: z.number().positive().max(5000).nullable(),
  liquid: z.boolean(),
  hydrating: z.boolean(),
  caffeine_per_100: z.number().min(0).max(500).nullable(),
})

export const MealIngredientsSchema = z.array(MealIngredientSchema).min(1).max(40)

export const UserIngredientInputSchema = z.object({
  name: z.string().min(1).max(80),
  brand: z.string().max(80).nullable().optional(),
  barcode: z.string().max(32).nullable().optional(),
  cal_per_100: z.number().min(0).max(1000),
  protein_per_100: z.number().min(0).max(100),
  carbs_per_100: z.number().min(0).max(100),
  unit_name: z.string().max(24).nullable().optional(),
  unit_grams: z.number().positive().max(5000).nullable().optional(),
  liquid: z.boolean().optional(),
  hydrating: z.boolean().optional(),
  caffeine_per_100: z.number().min(0).max(500).nullable().optional(),
})
