/**
 * One-off: decomposes the legacy mentor_context.about_me blob into discrete
 * user_profile_facts rows, then retires the blob (dropped in a follow-up
 * migration).
 *
 * The existing blob contains fabricated precision — invented scores like
 * "recovery capacity around 8.5/10" that no data produced — so the prompt below
 * hard-bans scores and judgments. Dry-run first and eyeball the output.
 *
 * Run with: npx tsx scripts/seed-profile-facts.ts [--commit]
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf-8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
Object.assign(process.env, env)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const COMMIT = process.argv.includes('--commit')

const CATEGORIES = [
  'identity', 'goals', 'training', 'nutrition', 'health',
  'relationships', 'work', 'values', 'preferences', 'struggles',
] as const

const TOOL: Anthropic.Tool = {
  name: 'emit_facts',
  description: 'Emit the discrete facts contained in this profile document.',
  input_schema: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: [...CATEGORIES] },
            content: { type: 'string', description: 'One self-contained sentence, third person.' },
          },
          required: ['category', 'content'],
        },
      },
      dropped: {
        type: 'array',
        description: 'Claims you refused to carry forward, and why (one short line each).',
        items: { type: 'string' },
      },
    },
    required: ['facts', 'dropped'],
  },
}

const PROMPT = `Below is a legacy profile document about a person. It was written by a language model that repeatedly rewrote its own output, so it mixes real facts the person stated with confident-sounding material the model invented.

Decompose it into discrete factual statements, and drop everything that is not a fact.

DROP, do not carry forward:
- Every score, rating, grade, and percentage the model assigned ("recovery capacity around 8.5/10", "8/10 on consistency"). These were invented.
- Every evaluative judgment ("elite", "genuinely strong", "his biggest underminer", "excellent trajectory").
- Every piece of motivational or narrative framing ("the fire is lit", "channeling real energy").
- **Every measured number and every specific date.** This is the rule most likely to be broken, so apply it strictly. All of the following live in a database that the app queries directly, and a copy of them here would be stale within weeks while still being asserted as current:
  - lifted weights and rep counts, and any progression between them ("shoulder press went from 75x8 to 85x12")
  - sleep durations, HRV, resting heart rate, readiness or sleep scores ("HRV consistently 104-106ms", "8h+ total sleep")
  - calorie and protein amounts actually eaten ("hit 155g protein on his best day", "1,900 kcal one day")
  - anything anchored to a specific date ("push day dormant since June 17")

  Where such a sentence contains a real underlying pattern, rewrite it as the pattern with the numbers removed. "Shoulder press improved from 75x8 to 85x12 over three weeks" becomes nothing, because the progression is already in the logs. "Feast-or-famine intake: 1,900 kcal one day, near-zero the next" becomes "Luka's daily food intake swings between full days and days he barely eats." Keep the shape, drop the measurements.

  The one exception is a configured target or constraint the person chose rather than a measurement of what happened, such as a daily protein goal. Those are durable.

KEEP, as one sentence each:
- Who the person is and what situation they are in.
- Stable patterns in how they train, eat, sleep, and work.
- Goals they hold and constraints they are under.
- Recurring struggles, stated plainly and without diagnosis.
- Preferences and values they have expressed.

Rules: one fact per entry, one sentence, third person, self-contained. No hedging ("seems to", "appears to"). If a sentence in the source is pure judgment with no underlying fact, drop it and note it in "dropped".

PROFILE DOCUMENT:
`

async function main() {
  const { data: contexts, error } = await supabase
    .from('mentor_context')
    .select('user_id, about_me, updated_at')
    .not('about_me', 'is', null)

  if (error) throw error
  if (!contexts?.length) {
    console.log('No about_me blobs to seed.')
    return
  }

  console.log(`${COMMIT ? 'COMMIT' : 'DRY RUN'} — ${contexts.length} user(s) with a profile blob\n`)

  for (const ctx of contexts) {
    const blob = (ctx.about_me as string).trim()
    if (!blob) continue

    const { count } = await supabase
      .from('user_profile_facts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.user_id)
      .eq('source_kind', 'seed')

    if (count && count > 0) {
      console.log(`user ${ctx.user_id}: already seeded (${count} facts), skipping\n`)
      continue
    }

    const res = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'emit_facts' },
      messages: [{ role: 'user', content: PROMPT + blob }],
    })

    const block = res.content.find(c => c.type === 'tool_use')
    if (!block || block.type !== 'tool_use') {
      console.error(`user ${ctx.user_id}: model returned no tool call, skipping`)
      continue
    }

    const { facts, dropped } = block.input as {
      facts: Array<{ category: string; content: string }>
      dropped: string[]
    }

    console.log(`user ${ctx.user_id} — ${facts.length} facts kept, ${dropped.length} claims dropped`)
    console.log('\n  KEPT:')
    for (const f of facts) console.log(`    [${f.category}] ${f.content}`)
    console.log('\n  DROPPED:')
    for (const d of dropped) console.log(`    - ${d}`)
    console.log()

    if (!COMMIT) continue

    const seenAt = (ctx.updated_at as string) ?? new Date().toISOString()
    const rows = facts
      .filter(f => f.content?.trim() && (CATEGORIES as readonly string[]).includes(f.category))
      .map(f => ({
        user_id: ctx.user_id,
        category: f.category,
        tier: 'durable',
        content: f.content.trim(),
        source_kind: 'seed',
        source_id: null,
        first_seen_at: seenAt,
        last_confirmed_at: seenAt,
      }))

    const { error: insertError } = await supabase.from('user_profile_facts').insert(rows)
    if (insertError) {
      console.error(`user ${ctx.user_id}: insert failed`, insertError)
      continue
    }
    console.log(`  inserted ${rows.length} facts\n`)
  }

  if (!COMMIT) console.log('Dry run only. Re-run with --commit to write.')
}

main().catch(e => { console.error(e); process.exit(1) })
