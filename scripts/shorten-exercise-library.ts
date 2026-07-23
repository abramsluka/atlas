/**
 * One-time: generate a compact display name (short_name) for each library
 * exercise — what shows in the horizontal exercise rail. The full name stays
 * in exercise_library.name for the info sheet. Then re-shortens the names of
 * existing library-linked gym_exercises rows to match.
 * Resumable via `short_name is null`. Run: npx tsx scripts/shorten-exercise-library.ts
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
const BATCH = 30

const SYSTEM = `You shorten exercise names for a phone gym app's horizontal scroll rail, where long names make each chip too wide. For each exercise, produce a compact "short_name": what a lifter would jot on a whiteboard.

Rules:
- Aim for 1-3 words, roughly <= 16 characters. Title Case.
- Drop the equipment word when the movement is already clear: "Barbell Bench Press" -> "Bench Press"; "Barbell Squat" -> "Squat"; "Barbell Deadlift" -> "Deadlift".
- BUT keep a distinguishing token when dropping it would collide with a sibling variant: "Smith Machine Bench Press" -> "Smith Bench"; "Dumbbell Bench Press" -> "DB Bench"; "Incline Barbell Bench Press" -> "Incline Bench"; "Incline Dumbbell Press" -> "Incline DB Press".
- Use standard gym abbreviations: Dumbbell -> DB, Machine -> (usually drop), Romanian Deadlift -> RDL, Overhead Press -> OHP, Single-Arm -> 1-Arm, Alternating -> Alt.
- Keep left/right or grip distinctions only if they matter for identifying the movement.
- Never invent a name that would be ambiguous with a more common lift. When in doubt, keep it a little longer rather than wrong.
- Echo each id exactly.`

interface Row { id: string; name: string }
interface ShortItem { id: string; short_name: string }

const tools: Anthropic.Tool[] = [{
  name: 'emit_short_names',
  description: 'Emit a compact short_name for every exercise in the batch.',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, short_name: { type: 'string' } },
          required: ['id', 'short_name'],
        },
      },
    },
    required: ['items'],
  },
}]

async function shortenBatch(rows: Row[], attempt = 1): Promise<ShortItem[]> {
  const listing = rows.map(r => `id: ${r.id}\n  name: ${r.name}`).join('\n')
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools,
      tool_choice: { type: 'tool', name: 'emit_short_names' },
      messages: [{ role: 'user', content: `Shorten these ${rows.length} exercise names:\n\n${listing}` }],
    })
    const toolUse = msg.content.find(c => c.type === 'tool_use')
    if (!toolUse || toolUse.type !== 'tool_use') throw new Error('no tool_use block')
    return (toolUse.input as { items: ShortItem[] }).items
  } catch (e) {
    if (attempt === 1) { console.warn(`  batch failed (${e}), retrying once...`); return shortenBatch(rows, 2) }
    throw e
  }
}

async function generate() {
  let total = 0
  let stalls = 0
  for (;;) {
    const { data: rows, error } = await supabase
      .from('exercise_library')
      .select('id, name')
      .is('short_name', null)
      .order('id')
      .limit(BATCH)
    if (error) { console.error(error); process.exit(1) }
    if (!rows?.length) break

    let items: ShortItem[]
    try { items = await shortenBatch(rows as Row[]) }
    catch (e) { console.error(`Batch at ${rows[0].id} failed twice, skipping:`, e); continue }

    const validIds = new Set(rows.map(r => r.id))
    const before = total
    for (const item of items) {
      if (!validIds.has(item.id) || !item.short_name?.trim()) continue
      const { error: upErr } = await supabase
        .from('exercise_library')
        .update({ short_name: item.short_name.trim().slice(0, 40) })
        .eq('id', item.id)
      if (upErr) { console.error(`  update failed for ${item.id}:`, upErr); continue }
      total++
    }
    stalls = total === before ? stalls + 1 : 0
    if (stalls >= 2) { console.error('No progress for 2 batches, bailing.'); break }
    console.log(`Shortened ${total} so far (last batch: ${rows[0].id} ...)`)
  }
  const { count } = await supabase
    .from('exercise_library')
    .select('*', { count: 'exact', head: true })
    .is('short_name', null)
  console.log(`Generation done. ${total} named this run; ${count} still null.`)
  return count ?? 0
}

// Re-shorten existing library-linked gym_exercises to the short display name.
async function reshortenLinked() {
  const { data: lib } = await supabase.from('exercise_library').select('id, short_name')
  const shortById = new Map((lib ?? []).map(l => [l.id, l.short_name as string | null]))

  const { data: exercises } = await supabase
    .from('gym_exercises')
    .select('id, name, library_id')
    .not('library_id', 'is', null)
  if (!exercises?.length) { console.log('No linked exercises to re-shorten.'); return }

  let updated = 0
  for (const ex of exercises) {
    const short = shortById.get(ex.library_id as string)
    if (!short || short === ex.name) continue
    const { error } = await supabase.from('gym_exercises').update({ name: short }).eq('id', ex.id)
    if (error) { console.error(`  update failed for ${ex.name}:`, error); continue }
    console.log(`  "${ex.name}" -> "${short}"`)
    updated++
  }
  console.log(`Re-shortened ${updated} linked exercise name(s).`)
}

async function run() {
  const remaining = await generate()
  if (remaining === 0) await reshortenLinked()
  else console.log('Skipping re-shorten until all short_names are generated (re-run to finish).')
}

run().catch(e => { console.error(e); process.exit(1) })
