import { INGREDIENT_LIBRARY, type LibraryIngredient } from './ingredientLibrary'
import type { SavedMeal, UserIngredient } from './types'

export type SearchHit =
  | { kind: 'library'; score: number; item: LibraryIngredient }
  | { kind: 'custom'; score: number; item: UserIngredient }
  | { kind: 'meal'; score: number; item: SavedMeal }

function scoreName(q: string, name: string, aliases?: string[]): number {
  const n = name.toLowerCase()
  if (n === q) return 100
  if (n.startsWith(q)) return 80
  // word-boundary match: "bre" hits "chicken breast"
  if (n.split(/[\s(,]+/).some(w => w.startsWith(q))) return 60
  if (n.includes(q)) return 40
  if (aliases?.some(a => a === q)) return 90
  if (aliases?.some(a => a.startsWith(q))) return 70
  if (aliases?.some(a => a.includes(q))) return 30
  return 0
}

/** Unified search over bundled library + user's custom ingredients + saved
 *  meals. Pure string scoring, no network. Custom items and saved meals get a
 *  personal-layer boost so your own stuff outranks the bundled generics. */
export function searchIngredients(
  query: string,
  custom: UserIngredient[],
  meals: SavedMeal[],
  limit = 12
): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const hits: SearchHit[] = []

  for (const item of meals) {
    const s = scoreName(q, item.name)
    if (s > 0) hits.push({ kind: 'meal', score: s + 15, item })
  }
  for (const item of custom) {
    const s = Math.max(
      scoreName(q, item.name),
      item.brand ? scoreName(q, item.brand) : 0
    )
    if (s > 0) hits.push({ kind: 'custom', score: s + 10, item })
  }
  for (const item of INGREDIENT_LIBRARY) {
    const s = scoreName(q, item.name, item.aliases)
    if (s > 0) hits.push({ kind: 'library', score: s, item })
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit)
}
