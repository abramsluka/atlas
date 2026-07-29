import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicForUser } from '@/lib/anthropic'
import { CATEGORY_ENUM, FACT_RULES } from './prompts'
import { isFactCategory, type FactSourceKind } from './types'

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'

interface ExtractInput {
  sourceKind: FactSourceKind
  sourceId: string | null
  content: string
  /** ISO timestamp or YYYY-MM-DD — when the content was written. */
  occurredAt: string
}

interface ExistingFact {
  id: string
  category: string
  content: string
}

interface ExtractResult {
  new?: Array<{ category?: string; tier?: string; content?: string }>
  confirms?: string[]
  contradicts?: Array<{ id?: string; replacement?: string }>
}

const EXTRACT_TOOL: Anthropic.Tool = {
  name: 'emit_facts',
  description: 'Emit the profile changes implied by this content.',
  input_schema: {
    type: 'object',
    properties: {
      new: {
        type: 'array',
        description: 'Facts not already present in the existing list. Empty if nothing new.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORY_ENUM },
            tier: { type: 'string', enum: ['durable', 'state'] },
            content: { type: 'string', description: 'One self-contained sentence, third person.' },
          },
          required: ['category', 'tier', 'content'],
        },
      },
      confirms: {
        type: 'array',
        description: 'IDs of existing facts this content restates or reinforces.',
        items: { type: 'string' },
      },
      contradicts: {
        type: 'array',
        description: 'Existing facts this content shows are no longer true, with what replaces them.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            replacement: { type: 'string', description: 'The corrected fact, one sentence.' },
          },
          required: ['id', 'replacement'],
        },
      },
    },
    required: ['new', 'confirms', 'contradicts'],
  },
}

/**
 * Pulls profile facts out of a piece of user-written content and reconciles them
 * against what is already known. Runs in the background via after() — it never
 * throws, and a missing API key is a silent no-op rather than an error.
 */
export async function extractFacts(
  db: SupabaseClient,
  userId: string,
  input: ExtractInput,
): Promise<void> {
  try {
    const content = input.content.trim()
    if (!content) return

    const anthropic = await getAnthropicForUser(userId)
    if (!anthropic) return

    // Both tiers, so a restatement can confirm a state fact and a life change
    // can contradict one. Durable-only here meant state rows were invisible to
    // the extractor and it just kept appending near-duplicates.
    const { data: existingRows } = await db
      .from('user_profile_facts')
      .select('id, category, content')
      .eq('user_id', userId)
      .in('status', ['active', 'pinned'])
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('last_confirmed_at', { ascending: false })
      .limit(120)

    const existing = (existingRows ?? []) as ExistingFact[]
    const existingList = existing.length
      ? existing.map(f => `[${f.id}] (${f.category}) ${f.content}`).join('\n')
      : '(none yet — this is the first pass)'

    const sourceLabel = input.sourceKind === 'mentor' ? 'a conversation with his AI mentor' : 'a journal entry'

    const res = await anthropic.messages.create({
      model: EXTRACT_MODEL,
      max_tokens: 1200,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_facts' },
      messages: [{
        role: 'user',
        content: `You maintain a factual profile of a person from what they write. Below is what you already know, then something new they wrote (${sourceLabel}, dated ${input.occurredAt}).

Decide what is genuinely new, what restates something you already have, and what contradicts it.

${FACT_RULES}

EXISTING FACTS:
${existingList}

NEW CONTENT:
${content}`,
      }],
    })

    const block = res.content.find(c => c.type === 'tool_use')
    if (!block || block.type !== 'tool_use') return
    const result = block.input as ExtractResult

    const existingIds = new Set(existing.map(f => f.id))
    const nowIso = new Date().toISOString()
    const occurredIso = normalizeTimestamp(input.occurredAt)

    // New facts
    const inserts = (result.new ?? [])
      .filter(f => f.content?.trim() && isFactCategory(f.category))
      .map(f => ({
        user_id: userId,
        category: f.category as string,
        tier: f.tier === 'state' ? 'state' : 'durable',
        content: f.content!.trim(),
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        first_seen_at: occurredIso,
        last_confirmed_at: occurredIso,
        expires_at: f.tier === 'state' ? addDays(occurredIso, 14) : null,
      }))

    if (inserts.length) {
      await db.from('user_profile_facts').insert(inserts)
    }

    // Confirmations — bump recency so consolidation ranks them as still live
    const confirmIds = (result.confirms ?? []).filter(id => existingIds.has(id))
    if (confirmIds.length) {
      await db
        .from('user_profile_facts')
        .update({ last_confirmed_at: occurredIso })
        .eq('user_id', userId)
        .in('id', confirmIds)
    }

    // Contradictions — archive the old row, carry its first_seen_at onto the
    // replacement so the profile keeps showing how long it has known this.
    for (const c of result.contradicts ?? []) {
      if (!c.id || !c.replacement?.trim() || !existingIds.has(c.id)) continue

      const { data: old } = await db
        .from('user_profile_facts')
        .select('category, tier, first_seen_at, status')
        .eq('user_id', userId)
        .eq('id', c.id)
        .maybeSingle()
      if (!old) continue

      // Pinned facts are user-protected. Leave them alone.
      if (old.status === 'pinned') continue

      await db
        .from('user_profile_facts')
        .update({ status: 'archived' })
        .eq('user_id', userId)
        .eq('id', c.id)

      await db.from('user_profile_facts').insert({
        user_id: userId,
        category: old.category,
        tier: old.tier,
        content: c.replacement.trim(),
        source_kind: input.sourceKind,
        source_id: input.sourceId,
        first_seen_at: old.first_seen_at ?? occurredIso,
        last_confirmed_at: occurredIso,
        expires_at: old.tier === 'state' ? addDays(nowIso, 14) : null,
      })
    }
  } catch (e) {
    console.error('[profile/extractFacts] failed:', e)
  }
}

/** journal_entries.date is YYYY-MM-DD; mentor turns pass a full ISO string. */
function normalizeTimestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T12:00:00.000Z`
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86_400_000).toISOString()
}
