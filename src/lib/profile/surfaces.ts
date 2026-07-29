import { FACT_CATEGORIES, type FactCategory, type ProfileSurface } from './types'

// The whole privacy model lives here. There is no per-entry opt-out: everything
// the user writes gets ingested, and this map is what keeps a relationships fact
// out of a gym-set coach reply.
export const SURFACE_CATEGORIES: Record<ProfileSurface, FactCategory[] | 'all'> = {
  mentor: 'all',
  journal: 'all',
  home: 'all',
  gym: ['training', 'goals', 'health', 'identity'],
  food: ['nutrition', 'health', 'goals', 'training'],
  assistant: ['identity', 'goals', 'preferences'],
}

export function categoriesForSurface(surface: ProfileSurface): FactCategory[] {
  const configured = SURFACE_CATEGORIES[surface]
  return configured === 'all' ? [...FACT_CATEGORIES] : configured
}
