/**
 * One-time cleanup: deletes all unnamed in-progress workouts.
 * Run with: npx tsx cleanup-workouts.ts
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

async function run() {
  // Find all unnamed in-progress workouts
  const { data: workouts, error: fetchError } = await supabase
    .from('workouts')
    .select('id, name, created_at')
    .is('completed_at', null)
    .or('name.is.null,name.eq.')

  if (fetchError) { console.error('Fetch error:', fetchError); process.exit(1) }
  if (!workouts?.length) { console.log('No unnamed in-progress workouts found.'); return }

  console.log(`Found ${workouts.length} workouts to delete:`)
  workouts.forEach(w => console.log(`  - ${w.id} (created ${w.created_at})`))

  const ids = workouts.map(w => w.id)

  // Get exercise IDs
  const { data: exercises } = await supabase.from('exercises').select('id').in('workout_id', ids)
  const exerciseIds = (exercises ?? []).map(e => e.id)

  // Delete in order
  if (exerciseIds.length > 0) {
    const { error: setsError } = await supabase.from('sets').delete().in('exercise_id', exerciseIds)
    if (setsError) { console.error('Sets delete error:', setsError); process.exit(1) }

    const { error: exError } = await supabase.from('exercises').delete().in('workout_id', ids)
    if (exError) { console.error('Exercises delete error:', exError); process.exit(1) }
  }

  const { error: wError } = await supabase.from('workouts').delete().in('id', ids)
  if (wError) { console.error('Workouts delete error:', wError); process.exit(1) }

  console.log(`Done. Deleted ${workouts.length} workouts.`)
}

run().catch(console.error)
