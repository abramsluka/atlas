/**
 * One-time seed: downloads free-exercise-db (public domain), upserts ~870
 * exercises into exercise_library, and uploads demo photos to the public
 * exercise-images bucket. Idempotent — safe to re-run; never touches the
 * AI-enriched columns (see enrich-exercise-library.ts).
 * Run with: npx tsx scripts/seed-exercise-library.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import os from 'os'

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

const ARCHIVE_URL = 'https://github.com/yuhonas/free-exercise-db/archive/refs/heads/main.tar.gz'
const WORK_DIR = path.join(os.tmpdir(), 'free-exercise-db-seed')
const REPO_DIR = path.join(WORK_DIR, 'free-exercise-db-main')

interface DatasetExercise {
  id: string
  name: string
  force: string | null
  level: string | null
  mechanic: string | null
  equipment: string | null
  primaryMuscles: string[]
  secondaryMuscles: string[]
  instructions: string[]
  category: string | null
  images: string[]
}

async function download() {
  if (existsSync(path.join(REPO_DIR, 'dist', 'exercises.json'))) {
    console.log('Archive already extracted, skipping download.')
    return
  }
  mkdirSync(WORK_DIR, { recursive: true })
  console.log('Downloading dataset archive...')
  const tarPath = path.join(WORK_DIR, 'main.tar.gz')
  execSync(`curl -sL ${ARCHIVE_URL} -o ${tarPath}`, { stdio: 'inherit' })
  console.log('Extracting...')
  execSync(`tar -xzf ${tarPath} -C ${WORK_DIR}`, { stdio: 'inherit' })
}

async function upsertRows(exercises: DatasetExercise[]) {
  console.log(`Upserting ${exercises.length} rows...`)
  // Dataset-sourced columns only — re-runs must never clobber AI enrichment.
  const rows = exercises.map(ex => ({
    id: ex.id,
    name: ex.name,
    category: ex.category,
    equipment: ex.equipment,
    level: ex.level,
    mechanic: ex.mechanic,
    force: ex.force,
    primary_muscles: ex.primaryMuscles ?? [],
    secondary_muscles: ex.secondaryMuscles ?? [],
    instructions: ex.instructions ?? [],
    image_paths: ex.images ?? [],
    bodyweight: ex.equipment === 'body only', // heuristic; enrichment refines
  }))
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const { error } = await supabase.from('exercise_library').upsert(chunk, { onConflict: 'id' })
    if (error) { console.error(`Upsert error at chunk ${i}:`, error); process.exit(1) }
    console.log(`  rows ${i + 1}-${i + chunk.length}`)
  }
}

async function uploadImages(exercises: DatasetExercise[]) {
  const paths = exercises.flatMap(ex => ex.images ?? [])
  console.log(`Uploading ${paths.length} images (concurrency 8)...`)
  let done = 0
  let failed = 0
  for (let i = 0; i < paths.length; i += 8) {
    const batch = paths.slice(i, i + 8)
    await Promise.all(batch.map(async p => {
      const file = path.join(REPO_DIR, 'exercises', p)
      if (!existsSync(file)) { console.warn(`  missing local file: ${p}`); failed++; return }
      const { error } = await supabase.storage
        .from('exercise-images')
        .upload(p, readFileSync(file), { contentType: 'image/jpeg', upsert: true })
      if (error) { console.warn(`  upload failed ${p}: ${error.message}`); failed++; return }
      done++
    }))
    if ((i + 8) % 100 < 8) console.log(`  ${Math.min(i + 8, paths.length)}/${paths.length}`)
  }
  console.log(`Images done: ${done} uploaded, ${failed} failed.`)
}

async function run() {
  await download()
  const exercises: DatasetExercise[] = JSON.parse(
    readFileSync(path.join(REPO_DIR, 'dist', 'exercises.json'), 'utf-8')
  )
  console.log(`Dataset: ${exercises.length} exercises.`)
  await upsertRows(exercises)
  await uploadImages(exercises)
  const { count } = await supabase.from('exercise_library').select('*', { count: 'exact', head: true })
  console.log(`Done. exercise_library now has ${count} rows.`)
}

run().catch(e => { console.error(e); process.exit(1) })
