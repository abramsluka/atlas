export const FACT_CATEGORIES = [
  'identity',
  'goals',
  'training',
  'nutrition',
  'health',
  'relationships',
  'work',
  'values',
  'preferences',
  'struggles',
] as const

export type FactCategory = (typeof FACT_CATEGORIES)[number]

export type FactTier = 'durable' | 'state'
export type FactStatus = 'active' | 'archived' | 'pinned'
export type FactSourceKind = 'journal' | 'mentor' | 'checkin' | 'seed' | 'manual'

export interface ProfileFact {
  id: string
  category: FactCategory
  tier: FactTier
  content: string
  source_kind: FactSourceKind
  source_id: string | null
  status: FactStatus
  first_seen_at: string
  last_confirmed_at: string
  expires_at: string | null
}

/** A fact plus the journal entry it came from, for the Profile tab. */
export interface ProfileFactWithSource extends ProfileFact {
  source_date: string | null
  source_title: string | null
}

export type ProfileSurface = 'mentor' | 'journal' | 'home' | 'gym' | 'food' | 'assistant'

export function isFactCategory(v: unknown): v is FactCategory {
  return typeof v === 'string' && (FACT_CATEGORIES as readonly string[]).includes(v)
}
