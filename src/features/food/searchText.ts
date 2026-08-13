/**
 * food_logs.search_text — the B-weighted half of the row's search vector.
 *
 * Photo logs: the vision model's list of everything it could actually see, so
 * history search finds a meal by its contents ("chicken apple sausage") even
 * when the title is generic ("Breakfast plate"). Manual logs: portion and brand.
 */
export function buildSearchText(visible: unknown, description?: string | null): string | null {
  const parts: string[] = []

  if (Array.isArray(visible)) {
    for (const v of visible) {
      const s = String(v).toLowerCase().replace(/\s+/g, ' ').trim()
      if (s && s.length <= 60) parts.push(s)
    }
  }

  const desc = description?.trim()
  if (desc) parts.push(desc.toLowerCase())

  const deduped = Array.from(new Set(parts)).slice(0, 20)
  return deduped.length > 0 ? deduped.join(', ') : null
}
