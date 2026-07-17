import type { MealIngredient, MealTotals } from './types'
import type { LibraryIngredient } from './ingredientLibrary'
import type { UserIngredient } from './types'

const ML_PER_FL_OZ = 29.5735

export function macrosFor(ing: MealIngredient): { cal: number; protein: number; carbs: number } {
  const f = ing.grams / 100
  return {
    cal: ing.per100.cal * f,
    protein: ing.per100.protein * f,
    carbs: ing.per100.carbs * f,
  }
}

export function mealTotals(ingredients: MealIngredient[]): MealTotals {
  let cal = 0
  let protein = 0
  let carbs = 0
  let grams = 0
  let hydratingMl = 0
  let caffeine = 0
  for (const ing of ingredients) {
    const m = macrosFor(ing)
    cal += m.cal
    protein += m.protein
    carbs += m.carbs
    grams += ing.grams
    if (ing.liquid && ing.hydrating) hydratingMl += ing.grams
    if (ing.caffeine_per_100 != null) caffeine += (ing.caffeine_per_100 * ing.grams) / 100
  }
  return {
    cal: Math.round(cal),
    protein: Math.round(protein * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
    grams: Math.round(grams),
    volume_oz: hydratingMl > 0 ? Math.round((hydratingMl / ML_PER_FL_OZ) * 10) / 10 : null,
    caffeine_mg: Math.round(caffeine),
  }
}

/** Human portion string, e.g. "3 ingredients · 420g" or "240 ml" for a lone drink. */
export function mealPortionDesc(ingredients: MealIngredient[]): string {
  if (ingredients.length === 1) {
    const ing = ingredients[0]
    return `${Math.round(ing.grams)}${ing.liquid ? ' ml' : 'g'}`
  }
  const totals = mealTotals(ingredients)
  return `${ingredients.length} ingredients · ${totals.grams}g`
}

export function fromLibrary(ing: LibraryIngredient, grams: number): MealIngredient {
  const unit = ing.units?.[0] ?? null
  return {
    ref: ing.id,
    name: ing.name,
    emoji: ing.emoji,
    grams,
    per100: { ...ing.per100 },
    unit_name: unit?.name ?? null,
    unit_grams: unit?.grams ?? null,
    liquid: Boolean(ing.liquid),
    hydrating: Boolean(ing.hydrating),
    caffeine_per_100: ing.caffeinePer100 ?? null,
  }
}

export function fromUserIngredient(ing: UserIngredient, grams: number): MealIngredient {
  return {
    ref: ing.id,
    name: ing.name,
    emoji: null,
    grams,
    per100: {
      cal: Number(ing.cal_per_100),
      protein: Number(ing.protein_per_100),
      carbs: Number(ing.carbs_per_100),
    },
    unit_name: ing.unit_name,
    unit_grams: ing.unit_grams != null ? Number(ing.unit_grams) : null,
    liquid: ing.liquid,
    hydrating: ing.hydrating,
    caffeine_per_100: ing.caffeine_per_100 != null ? Number(ing.caffeine_per_100) : null,
  }
}

/** Default starting amount when an ingredient is added: one natural unit if it
 *  has one, otherwise 100g solids / 240ml liquids. */
export function defaultGrams(ing: { unit_grams?: number | null; liquid?: boolean }): number {
  if (ing.unit_grams != null && ing.unit_grams > 0) return Number(ing.unit_grams)
  return ing.liquid ? 240 : 100
}
