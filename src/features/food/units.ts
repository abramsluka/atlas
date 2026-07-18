// Amount units for food entry. Everything is stored as grams (ml treated 1:1
// for liquids) — these helpers only convert at the input/display edge.

export const AMOUNT_UNITS = ['g', 'ml', 'oz', 'lb'] as const
export type AmountUnit = (typeof AMOUNT_UNITS)[number]

export const UNIT_GRAMS: Record<AmountUnit, number> = {
  g: 1,
  ml: 1,
  oz: 28.35,
  lb: 453.59,
}

export function nextUnit(unit: AmountUnit): AmountUnit {
  return AMOUNT_UNITS[(AMOUNT_UNITS.indexOf(unit) + 1) % AMOUNT_UNITS.length]
}

export function toGrams(value: number, unit: AmountUnit): number {
  return value * UNIT_GRAMS[unit]
}

export function fromGrams(grams: number, unit: AmountUnit): number {
  return grams / UNIT_GRAMS[unit]
}

// "150" for g/ml, "5.3" for oz, "0.33" for lb — trailing zeros stripped.
export function formatAmount(grams: number, unit: AmountUnit): string {
  const v = fromGrams(grams, unit)
  if (unit === 'g' || unit === 'ml') return String(Math.round(v))
  const decimals = unit === 'oz' ? 1 : 2
  return String(Number(v.toFixed(decimals)))
}
