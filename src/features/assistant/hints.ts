// Deterministic fallback chips for the Orb's empty state — used until the
// learned per-user chips (orb_chip_cache) have data for the current time band,
// and ALWAYS during an active gym session (tactical context beats habits).
// Pure rules table: page + hour + session state in, 3 chips out.

export type HintBand = 'morning' | 'midday' | 'evening'

export function bandOf(hour: number): HintBand {
  return hour < 11 ? 'morning' : hour < 17 ? 'midday' : 'evening'
}

export interface HintContext {
  pathname: string
  hour: number
  inGymSession: boolean
}

export const GYM_SESSION_HINTS = [
  'Log my next set',
  'How long should I rest?',
  "What's left in today's workout?",
]

const DEFAULT_HINTS = [
  'Did bench, 8 reps at 135',
  'Took my magnesium and multivitamin',
  'Weight is 176, had 20 oz of water',
]

// First match wins, top to bottom.
const RULES: Array<{ match: (c: HintContext & { band: HintBand }) => boolean; chips: string[] }> = [
  { match: c => c.pathname.startsWith('/gym') && c.inGymSession, chips: GYM_SESSION_HINTS },
  { match: c => c.pathname.startsWith('/gym') && c.band !== 'evening', chips: ["What's today's workout?", 'Should I push or go light today?', 'Did bench, 8 reps at 135'] },
  { match: c => c.pathname.startsWith('/gym'), chips: ["Log today's session", "How did this week's volume look?", 'Swap an exercise for tomorrow'] },
  { match: c => c.pathname.startsWith('/health') && c.band === 'morning', chips: ['Weight is 176', 'Took my morning supplements', 'Had 16 oz of water'] },
  { match: c => c.pathname.startsWith('/health') && c.band === 'midday', chips: ['Log my lunch', 'Had a coffee', 'How much water so far today?'] },
  { match: c => c.pathname.startsWith('/health'), chips: ['Log dinner', 'Took my evening supplements', 'How was my day, nutrition-wise?'] },
  { match: c => c.band === 'morning', chips: ['Took my supplements', 'Weight is 176', "What's my recovery today?"] },
  { match: c => c.band === 'evening', chips: ['Log dinner', 'Journal: today was…', 'How did today go?'] },
]

export function getOrbHints(ctx: HintContext): string[] {
  const c = { ...ctx, band: bandOf(ctx.hour) }
  return RULES.find(r => r.match(c))?.chips ?? DEFAULT_HINTS
}
