import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAnthropicForUser } from '@/lib/anthropic'
import { CATEGORY_ENUM, FACT_RULES } from './prompts'
import { isFactCategory } from './types'

const CONSOLIDATE_MODEL = 'claude-haiku-4-5-20251001'
const STATE_TTL_DAYS = 14
const WINDOW_DAYS = 14

interface DurableRow {
  id: string
  category: string
  content: string
  status: string
  first_seen_at: string
  last_confirmed_at: string
}

const MERGE_TOOL: Anthropic.Tool = {
  name: 'emit_consolidation',
  description: 'Emit the cleanup actions for this fact set.',
  input_schema: {
    type: 'object',
    properties: {
      merge: {
        type: 'array',
        description: 'Groups of near-duplicate facts to collapse into one.',
        items: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Two or more fact IDs saying the same thing.' },
            content: { type: 'string', description: 'The single merged fact.' },
          },
          required: ['ids', 'content'],
        },
      },
      rewrite: {
        type: 'array',
        description: 'Facts that are still true but drifted or read badly.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['id', 'content'],
        },
      },
      archive: {
        type: 'array',
        description: 'IDs of facts the recent content shows are no longer true.',
        items: { type: 'string' },
      },
    },
    required: ['merge', 'rewrite', 'archive'],
  },
}

const STATE_TOOL: Anthropic.Tool = {
  name: 'emit_state',
  description: 'Emit the current-state facts for the recent window.',
  input_schema: {
    type: 'object',
    properties: {
      state: {
        type: 'array',
        description: 'At most 4 facts about where this person is right now. Empty if the window is thin.',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORY_ENUM },
            content: { type: 'string', description: 'One sentence, third person, present tense.' },
          },
          required: ['category', 'content'],
        },
      },
    },
    required: ['state'],
  },
}

/**
 * Weekly-ish cleanup, fired lazily from getProfileBlock when the profile goes
 * stale. Merges duplicates, archives what recent writing contradicts, and fully
 * regenerates the state tier. Pinned facts are read-only context here.
 */
export async function consolidateProfile(db: SupabaseClient, userId: string): Promise<void> {
  try {
    const anthropic = await getAnthropicForUser(userId)
    if (!anthropic) return

    const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
    const windowStartDate = windowStart.toISOString().slice(0, 10)

    const [durableRes, journalRes, checkinRes] = await Promise.all([
      db
        .from('user_profile_facts')
        .select('id, category, content, status, first_seen_at, last_confirmed_at')
        .eq('user_id', userId)
        .in('status', ['active', 'pinned'])
        .eq('tier', 'durable')
        .order('last_confirmed_at', { ascending: false }),
      db
        .from('journal_entries')
        .select('date, title, body, audio_transcript, mood')
        .eq('user_id', userId)
        .gte('date', windowStartDate)
        .order('date', { ascending: false })
        .limit(30),
      db
        .from('daily_checkins')
        .select('date, morning_intent, evening_reflection')
        .eq('user_id', userId)
        .gte('date', windowStartDate)
        .order('date', { ascending: false }),
    ])

    const durable = (durableRes.data ?? []) as DurableRow[]
    const recentText = buildRecentText(journalRes.data ?? [], checkinRes.data ?? [])

    if (durable.length) {
      await mergePass(db, userId, anthropic, durable, recentText)
    }
    await statePass(db, userId, anthropic, recentText)

    await db.from('mentor_context').upsert(
      { user_id: userId, last_consolidated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  } catch (e) {
    // Leave last_consolidated_at untouched so the next read retries.
    console.error('[profile/consolidateProfile] failed:', e)
  }
}

async function mergePass(
  db: SupabaseClient,
  userId: string,
  anthropic: Anthropic,
  durable: DurableRow[],
  recentText: string,
): Promise<void> {
  const editable = durable.filter(f => f.status !== 'pinned')
  if (!editable.length) return

  const pinned = durable.filter(f => f.status === 'pinned')

  const res = await anthropic.messages.create({
    model: CONSOLIDATE_MODEL,
    max_tokens: 2000,
    tools: [MERGE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_consolidation' },
    messages: [{
      role: 'user',
      content: `Clean up this factual profile. Collapse near-duplicates, rewrite anything that has drifted or reads badly, and archive facts the recent writing shows are no longer true. Be conservative: when in doubt, leave a fact alone. Do not invent anything new here.

${FACT_RULES}

${pinned.length ? `PINNED FACTS (read-only context, never touch these):\n${pinned.map(f => `(${f.category}) ${f.content}`).join('\n')}\n\n` : ''}FACTS TO CLEAN UP:
${editable.map(f => `[${f.id}] (${f.category}) ${f.content}`).join('\n')}

RECENT WRITING (last ${WINDOW_DAYS} days):
${recentText || '(nothing recent)'}`,
    }],
  })

  const block = res.content.find(c => c.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return
  const result = block.input as {
    merge?: Array<{ ids?: string[]; content?: string }>
    rewrite?: Array<{ id?: string; content?: string }>
    archive?: string[]
  }

  const editableById = new Map(editable.map(f => [f.id, f]))

  // Merges — keep the oldest row as the survivor so first_seen_at stays honest.
  for (const group of result.merge ?? []) {
    const ids = (group.ids ?? []).filter(id => editableById.has(id))
    if (ids.length < 2 || !group.content?.trim()) continue

    const rows = ids.map(id => editableById.get(id)!)
    const survivor = rows.reduce((a, b) => (a.first_seen_at <= b.first_seen_at ? a : b))
    const newest = rows.reduce((a, b) => (a.last_confirmed_at >= b.last_confirmed_at ? a : b))

    await db
      .from('user_profile_facts')
      .update({ content: group.content.trim(), last_confirmed_at: newest.last_confirmed_at })
      .eq('user_id', userId)
      .eq('id', survivor.id)

    const losers = ids.filter(id => id !== survivor.id)
    if (losers.length) {
      await db
        .from('user_profile_facts')
        .update({ status: 'archived' })
        .eq('user_id', userId)
        .in('id', losers)
      losers.forEach(id => editableById.delete(id))
    }
  }

  for (const r of result.rewrite ?? []) {
    if (!r.id || !r.content?.trim() || !editableById.has(r.id)) continue
    await db
      .from('user_profile_facts')
      .update({ content: r.content.trim() })
      .eq('user_id', userId)
      .eq('id', r.id)
  }

  const archiveIds = (result.archive ?? []).filter(id => editableById.has(id))
  if (archiveIds.length) {
    await db
      .from('user_profile_facts')
      .update({ status: 'archived' })
      .eq('user_id', userId)
      .in('id', archiveIds)
  }
}

async function statePass(
  db: SupabaseClient,
  userId: string,
  anthropic: Anthropic,
  recentText: string,
): Promise<void> {
  // The state tier is regenerated wholesale, never accumulated — that is what
  // keeps the profile from turning into a mood log.
  await db.from('user_profile_facts').delete().eq('user_id', userId).eq('tier', 'state')

  if (!recentText.trim()) return

  const res = await anthropic.messages.create({
    model: CONSOLIDATE_MODEL,
    max_tokens: 800,
    tools: [STATE_TOOL],
    tool_choice: { type: 'tool', name: 'emit_state' },
    messages: [{
      role: 'user',
      content: `Read this person's writing from the last ${WINDOW_DAYS} days and describe where they are right now: what they are in the middle of, what is weighing on them, how they have been feeling. This is the temporary layer of their profile and expires in two weeks, so it should be about the present moment rather than who they are in general.

${FACT_RULES}

RECENT WRITING:
${recentText}`,
    }],
  })

  const block = res.content.find(c => c.type === 'tool_use')
  if (!block || block.type !== 'tool_use') return
  const result = block.input as { state?: Array<{ category?: string; content?: string }> }

  const nowIso = new Date().toISOString()
  const expiresAt = new Date(Date.now() + STATE_TTL_DAYS * 86_400_000).toISOString()

  const rows = (result.state ?? [])
    .filter(s => s.content?.trim() && isFactCategory(s.category))
    .slice(0, 4)
    .map(s => ({
      user_id: userId,
      category: s.category as string,
      tier: 'state',
      content: s.content!.trim(),
      source_kind: 'journal' as const,
      source_id: null,
      first_seen_at: nowIso,
      last_confirmed_at: nowIso,
      expires_at: expiresAt,
    }))

  if (rows.length) {
    await db.from('user_profile_facts').insert(rows)
  }
}

function buildRecentText(
  entries: Array<{ date: string; title: string | null; body: string | null; audio_transcript: string | null; mood: number | null }>,
  checkins: Array<{ date: string; morning_intent: string | null; evening_reflection: string | null }>,
): string {
  const parts: string[] = []

  for (const e of entries) {
    const content = [e.body, e.audio_transcript].filter(Boolean).join('\n').trim()
    if (!content) continue
    parts.push(`[${e.date}]${e.title ? ` ${e.title}` : ''}${e.mood ? ` (mood ${e.mood}/5)` : ''}\n${content}`)
  }

  for (const c of checkins) {
    const bits = [c.morning_intent, c.evening_reflection].filter(Boolean).join(' / ').trim()
    if (bits) parts.push(`[${c.date}] check-in: ${bits}`)
  }

  return parts.join('\n\n')
}
