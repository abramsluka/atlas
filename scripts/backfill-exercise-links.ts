/**
 * One-time backfill: links existing gym_exercises rows to exercise_library
 * by normalized exact name/alias match. Run AFTER enrich-exercise-library.ts
 * (matching uses AI-generated aliases). Safe to re-run.
 * Run with: npx tsx scripts/backfill-exercise-links.ts
 */
import { createClient } from '@supabase/supabase-js'
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

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function run() {
  const { data: lib, error: libErr } = await supabase
    .from('exercise_library')
    .select('id, name, aliases, popularity')
  if (libErr || !lib) { console.error(libErr); process.exit(1) }

  // normalized name/alias -> entry; collisions resolved by higher popularity
  const lookup = new Map<string, { id: string; popularity: number }>()
  for (const entry of lib) {
    for (const key of [entry.name, ...(entry.aliases ?? [])].map(normalize)) {
      if (!key) continue
      const existing = lookup.get(key)
      if (!existing || entry.popularity > existing.popularity) {
        lookup.set(key, { id: entry.id, popularity: entry.popularity })
      }
    }
  }
  console.log(`Library lookup: ${lookup.size} keys from ${lib.length} entries.`)

  const { data: exercises, error: exErr } = await supabase
    .from('gym_exercises')
    .select('id, name, user_id')
    .is('library_id', null)
  if (exErr) { console.error(exErr); process.exit(1) }
  if (!exercises?.length) { console.log('No unlinked exercises.'); return }

  let matched = 0
  const unmatched: string[] = []
  for (const ex of exercises) {
    const hit = lookup.get(normalize(ex.name))
    if (!hit) { unmatched.push(ex.name); continue }
    const { error } = await supabase
      .from('gym_exercises')
      .update({ library_id: hit.id })
      .eq('id', ex.id)
    if (error) { console.error(`  update failed for ${ex.name}:`, error); continue }
    console.log(`  linked "${ex.name}" -> ${hit.id}`)
    matched++
  }
  console.log(`Done. ${matched} linked, ${unmatched.length} unmatched.`)
  if (unmatched.length) console.log('Unmatched:', unmatched.join(' | '))
}

run().catch(e => { console.error(e); process.exit(1) })
