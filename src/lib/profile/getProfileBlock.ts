import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { categoriesForSurface } from './surfaces'
import { consolidateProfile } from './consolidateProfile'
import type { ProfileFact, ProfileSurface } from './types'

const MAX_DURABLE_FACTS = 40
const CONSOLIDATE_AFTER_DAYS = 7

/**
 * Renders the slice of the user's profile that this AI surface is allowed to
 * see. Returns '' when there is nothing to say — callers push nothing onto
 * their prompt in that case.
 *
 * Also triggers background consolidation when the profile has gone stale. That
 * never blocks the response.
 */
export async function getProfileBlock(
  db: SupabaseClient,
  userId: string,
  surface: ProfileSurface,
): Promise<string> {
  try {
    const categories = categoriesForSurface(surface)
    const nowIso = new Date().toISOString()

    const [factsRes, ctxRes] = await Promise.all([
      db
        .from('user_profile_facts')
        .select('id, category, tier, content, source_kind, source_id, status, first_seen_at, last_confirmed_at, expires_at')
        .eq('user_id', userId)
        .in('status', ['active', 'pinned'])
        .in('category', categories)
        .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
        .order('last_confirmed_at', { ascending: false }),
      db.from('mentor_context').select('last_consolidated_at').eq('user_id', userId).maybeSingle(),
    ])

    const facts = (factsRes.data ?? []) as ProfileFact[]

    maybeConsolidate(db, userId, ctxRes.data?.last_consolidated_at ?? null, facts.length)

    if (!facts.length) return ''

    const durable = facts
      .filter(f => f.tier === 'durable')
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'pinned' ? -1 : 1
        return b.last_confirmed_at.localeCompare(a.last_confirmed_at)
      })
      .slice(0, MAX_DURABLE_FACTS)

    const state = facts.filter(f => f.tier === 'state')

    const sections: string[] = []

    if (durable.length) {
      const lines = durable.map(f => `[${f.category}] ${f.content} ${stampFor(f)}`)
      sections.push(`WHO THIS USER IS:\n${lines.join('\n')}`)
    }

    if (state.length) {
      sections.push(`RIGHT NOW (last 14 days):\n${state.map(f => f.content).join('\n')}`)
    }

    return sections.join('\n\n')
  } catch (e) {
    console.error('[profile/getProfileBlock] failed:', e)
    return ''
  }
}

/**
 * Identity facts read better with the date they were first learned; behavioural
 * ones with the date they were last seen holding true. Either way the model gets
 * a date, which is what stops it asserting stale things in the present tense.
 */
function stampFor(fact: ProfileFact): string {
  const stable = fact.category === 'identity' || fact.category === 'values'
  const iso = stable ? fact.first_seen_at : fact.last_confirmed_at
  const label = stable ? 'since' : 'confirmed'
  return `(${label} ${formatStamp(iso)})`
}

function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unknown'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function maybeConsolidate(
  db: SupabaseClient,
  userId: string,
  lastConsolidatedAt: string | null,
  factCount: number,
): void {
  if (factCount === 0) return

  if (lastConsolidatedAt) {
    const ageDays = (Date.now() - new Date(lastConsolidatedAt).getTime()) / 86_400_000
    if (ageDays < CONSOLIDATE_AFTER_DAYS) return
  }

  try {
    after(() => consolidateProfile(db, userId))
  } catch {
    // after() throws outside a request scope (scripts, tests). Skip silently.
  }
}
