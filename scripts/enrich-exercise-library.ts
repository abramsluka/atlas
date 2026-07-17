/**
 * One-time AI enrichment for exercise_library: default goal/rep range, step,
 * bodyweight flag, popularity, aliases, and starting-weight ratios.
 * Resumable: only processes rows where enriched_at is null, so a crash or
 * Ctrl-C loses at most one 20-row batch of AI spend.
 * Run with: npx tsx scripts/enrich-exercise-library.ts
 */
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'

// Parse .env.local manually
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

const MODEL = 'claude-opus-4-8'
const BATCH = 20

const GOAL_REPS: Record<string, { rep_min: number; rep_max: number }> = {
  strength: { rep_min: 3, rep_max: 5 },
  hypertrophy: { rep_min: 8, rep_max: 12 },
  endurance: { rep_min: 15, rep_max: 20 },
}

const SYSTEM = `You are an expert strength coach configuring a progressive-overload tracker's exercise library. For each exercise you receive, emit sensible defaults:

- default_goal: the rep-range goal a typical lifter would train this movement in. Heavy barbell compounds (squat, deadlift, bench) -> strength or hypertrophy; machine/cable/dumbbell accessories -> hypertrophy; core, band, and high-rep isolation work or stretches -> endurance.
- bodyweight: true only if the movement is loaded by body weight (pull-ups, dips, push-ups, planks, stretches) rather than external weight.
- step_lbs: smallest sensible weight increment in lbs. Barbell compounds 5, dumbbell/cable/machine isolation 2.5, plate-loaded machines 5 or 10, bodyweight/stretch 0 is not allowed — use 2.5 as the neutral default.
- popularity: 0-100, how commonly a gym-goer would actually log this in a lifting app. Bench press / squat / deadlift / lat pulldown / bicep curls ~90-100. Common accessories ~50-80. Obscure variations, strongman implements, stretches, physio drills ~0-20.
- aliases: common alternative names lifters use ("OHP", "Military Press", "RDL", "Skullcrushers"). Empty array if none.
- start_weight_ratio: a reasonable BEGINNER working-set weight as a fraction of the lifter's body weight (male reference). Examples: barbell bench ~0.5, barbell squat ~0.75, deadlift ~1.0, overhead press ~0.35, dumbbell curl (per hand) ~0.08, lateral raise ~0.05, lat pulldown ~0.5, leg press ~1.0. MUST be null for bodyweight movements, stretches, cardio, and anything not loaded with selectable weight.
- female_factor: multiplier to apply to start_weight_ratio for female lifters. ~0.5-0.7 for upper-body pressing/pulling, ~0.8 for lower body. MUST be null when start_weight_ratio is null.

Echo each exercise's id exactly as given.`

interface LibRow {
  id: string
  name: string
  category: string | null
  equipment: string | null
  mechanic: string | null
  level: string | null
  primary_muscles: string[]
}

interface EnrichedItem {
  id: string
  default_goal: 'strength' | 'hypertrophy' | 'endurance'
  bodyweight: boolean
  step_lbs: number
  popularity: number
  aliases: string[]
  start_weight_ratio: number | null
  female_factor: number | null
}

const tools: Anthropic.Tool[] = [{
  name: 'emit_enrichment',
  description: 'Emit enrichment defaults for every exercise in the batch.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            default_goal: { type: 'string', enum: ['strength', 'hypertrophy', 'endurance'] },
            bodyweight: { type: 'boolean' },
            step_lbs: { type: 'number' },
            popularity: { type: 'integer' },
            aliases: { type: 'array', items: { type: 'string' } },
            start_weight_ratio: { type: ['number', 'null'] },
            female_factor: { type: ['number', 'null'] },
          },
          required: ['id', 'default_goal', 'bodyweight', 'step_lbs', 'popularity', 'aliases', 'start_weight_ratio', 'female_factor'],
        },
      },
    },
    required: ['items'],
  },
}]

async function enrichBatch(rows: LibRow[], attempt = 1): Promise<EnrichedItem[]> {
  const listing = rows.map(r =>
    `id: ${r.id}\n  name: ${r.name}\n  category: ${r.category} | equipment: ${r.equipment} | mechanic: ${r.mechanic} | level: ${r.level} | primary: ${r.primary_muscles.join(', ')}`
  ).join('\n')
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      tools,
      tool_choice: { type: 'tool', name: 'emit_enrichment' },
      messages: [{ role: 'user', content: `Enrich these ${rows.length} exercises:\n\n${listing}` }],
    })
    const toolUse = msg.content.find(c => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no tool_use block')
    return (toolUse.input as { items: EnrichedItem[] }).items
  } catch (e) {
    if (attempt === 1) {
      console.warn(`  batch failed (${e}), retrying once...`)
      return enrichBatch(rows, 2)
    }
    throw e
  }
}

async function run() {
  let total = 0
  let stalls = 0
  for (;;) {
    const { data: rows, error } = await supabase
      .from('exercise_library')
      .select('id, name, category, equipment, mechanic, level, primary_muscles')
      .is('enriched_at', null)
      .order('id')
      .limit(BATCH)
    if (error) { console.error(error); process.exit(1) }
    if (!rows?.length) break

    let items: EnrichedItem[]
    try {
      items = await enrichBatch(rows as LibRow[])
    } catch (e) {
      console.error(`Batch starting at ${rows[0].id} failed twice, skipping:`, e)
      // Leave enriched_at null so a later run retries these rows.
      continue
    }

    const validIds = new Set(rows.map(r => r.id))
    const before = total
    for (const item of items) {
      if (!validIds.has(item.id)) { console.warn(`  hallucinated id ${item.id}, skipping`); continue }
      const goal = GOAL_REPS[item.default_goal] ? item.default_goal : 'hypertrophy'
      const hasRatio = item.start_weight_ratio != null && item.start_weight_ratio > 0 && !item.bodyweight
      const { error: upErr } = await supabase.from('exercise_library').update({
        default_goal: goal,
        ...GOAL_REPS[goal],
        bodyweight: item.bodyweight,
        step: Math.max(0.5, item.step_lbs || 2.5),
        popularity: Math.max(0, Math.min(100, Math.round(item.popularity))),
        aliases: (item.aliases ?? []).slice(0, 6),
        start_weight_ratio: hasRatio ? item.start_weight_ratio : null,
        female_factor: hasRatio ? item.female_factor : null,
        enriched_at: new Date().toISOString(),
      }).eq('id', item.id)
      if (upErr) { console.error(`  update failed for ${item.id}:`, upErr); continue }
      total++
    }
    stalls = total === before ? stalls + 1 : 0
    if (stalls >= 2) { console.error('No progress for 2 consecutive batches, bailing.'); break }
    console.log(`Enriched ${total} so far (last batch: ${rows[0].id} ...)`)
  }
  const { count } = await supabase
    .from('exercise_library')
    .select('*', { count: 'exact', head: true })
    .is('enriched_at', null)
  console.log(`Done. ${total} enriched this run; ${count} still pending.`)
}

run().catch(e => { console.error(e); process.exit(1) })
