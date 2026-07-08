// Learned open-chips for the Orb (ORB_SUGGESTIONS_SPEC.md §5). GET returns the
// cached chips instantly (or null when there's not enough history yet); when
// the cache is stale the recompute runs in after(), never on the hot path.

import { NextResponse, after } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'

const CLUSTER_MODEL = 'claude-haiku-4-5-20251001'
const STALE_MS = 24 * 3600_000
const MIN_COMMANDS = 20
const WINDOW_DAYS = 60
const MAX_GROUPS = 200

export interface OrbChips {
  morning: string[]
  midday: string[]
  evening: string[]
}

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: cache } = await db
    .from('orb_chip_cache')
    .select('chips, computed_at')
    .eq('user_id', user.id)
    .maybeSingle()

  const stale = !cache || Date.now() - new Date(cache.computed_at).getTime() > STALE_MS
  if (stale) {
    after(() => recomputeChips(user.id).catch(err => console.error('[assistant/chips] recompute:', err)))
  }

  return NextResponse.json({
    chips: (cache?.chips as OrbChips | undefined) ?? null,
    computedAt: cache?.computed_at ?? null,
  })
}

// ── The clustering pass (spec §5.3) ───────────────────────────────────────────

const SET_CHIPS_TOOL: Anthropic.Tool = {
  name: 'set_chips',
  input_schema: {
    type: 'object',
    properties: {
      morning: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      midday: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      evening: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    },
    required: ['morning', 'midday', 'evening'],
  },
}

const CLUSTER_SYSTEM = `You maintain the quick-launch chips for Luka's assistant orb. Below is every command he sent it
in the last 60 days, grouped with counts and typical hour. Produce the chips he'd most likely
want one tap away when he opens the orb, per time of day (morning < 11, midday 11–16, evening 17+).

RULES
- Up to 4 chips per band, ordered most→least common. Fewer is fine; NEVER pad with inventions.
- Merge variants of one intent into ONE chip ("log all my vitamins" / "took my vitamins" /
  "vitamins done" are the same chip). The label is HIS own most-used phrasing, lightly cleaned
  (capitalize, drop filler). ≤ 48 characters.
- Only recurring intents (total count ≥ 3 across variants). No one-offs.
- A chip must read as a command he'd send verbatim — it is sent as his message when tapped.
- Put an intent in the band(s) where he actually does it; an all-day habit may appear in more
  than one band.`

async function recomputeChips(userId: string) {
  const db = createServiceClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const { data: rows, error } = await db
    .from('orb_commands')
    .select('text, hour')
    .eq('user_id', userId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  if (!rows || rows.length < MIN_COMMANDS) return

  // Pre-group by exact text (case-insensitive) to keep tokens down.
  const groups = new Map<string, { text: string; count: number; hourSum: number; hourN: number }>()
  for (const r of rows as Array<{ text: string; hour: number | null }>) {
    const key = r.text.trim().toLowerCase()
    if (!key) continue
    const g = groups.get(key) ?? { text: r.text.trim(), count: 0, hourSum: 0, hourN: 0 }
    g.count += 1
    if (typeof r.hour === 'number') { g.hourSum += r.hour; g.hourN += 1 }
    groups.set(key, g)
  }
  const lines = [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_GROUPS)
    .map(g => `"${g.text}" ×${g.count}${g.hourN ? ` (~${Math.round(g.hourSum / g.hourN)}h)` : ''}`)
    .join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const res = await anthropic.messages.create({
    model: CLUSTER_MODEL,
    max_tokens: 400,
    system: CLUSTER_SYSTEM,
    tools: [SET_CHIPS_TOOL],
    tool_choice: { type: 'tool', name: 'set_chips' },
    messages: [{ role: 'user', content: `<commands>\n${lines}\n</commands>\nProduce the chips.` }],
  })

  const block = res.content.find(b => b.type === 'tool_use')
  const input = block?.type === 'tool_use' ? (block.input as Record<string, unknown>) : null
  if (!input) return

  const chips: OrbChips = {
    morning: sanitizeBand(input.morning),
    midday: sanitizeBand(input.midday),
    evening: sanitizeBand(input.evening),
  }

  const { error: upsertErr } = await db
    .from('orb_chip_cache')
    .upsert({ user_id: userId, chips, computed_at: new Date().toISOString() })
  if (upsertErr) throw upsertErr
}

function sanitizeBand(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of raw) {
    if (typeof s !== 'string') continue
    const t = s.trim()
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === 4) break
  }
  return out
}
