/**
 * One-time backfill for food history search: re-reads every already-stored meal
 * photo with the vision model and writes food_logs.search_text — the list of
 * everything actually visible in the shot. New photo logs get this at log time
 * (see src/app/api/health/food/route.ts); this catches everything logged before.
 *
 * Safe to re-run: skips rows that already have search_text unless --force.
 * Run with: npx tsx scripts/backfill-food-search.ts [--force] [--limit=N]
 */
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { readFileSync } from 'fs'

// Parse .env.local manually
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf-8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)
Object.assign(process.env, env)

const force = process.argv.includes('--force')
const limitArg = process.argv.find(a => a.startsWith('--limit='))
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 500
const CONCURRENCY = 2
const MAX_ATTEMPTS = 6

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Batch vision work trips the org's per-minute token limit; back off and retry.
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      const status = (err as { status?: number })?.status
      if (status !== 429 || attempt >= MAX_ATTEMPTS) throw err
      const wait = 2000 * attempt
      console.log(`  … ${label} rate limited, retrying in ${wait / 1000}s (attempt ${attempt})`)
      await sleep(wait)
    }
  }
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const PROMPT = `Look at this meal photo and list everything you can identify.

Return JSON only: {"visible": [...]} — 3-12 short lowercase strings covering every distinct food, drink, ingredient, garnish, sauce, and side you can see, plus preparation and cuisine words ("grilled", "breaded", "thai", "air fried").

Name the specific items even when the meal has a generic name — a plate the user called "Breakfast plate" should still list "chicken apple sausage", "scrambled eggs", "sourdough toast". This list is how the user searches their food history later, so be specific and generous. No prose.`

interface Row {
  id: string
  item_name: string
  storage_path: string
  search_text: string | null
}

async function describe(row: Row): Promise<string | null> {
  const { data: blob, error } = await supabase.storage.from('food-photos').download(row.storage_path)
  if (error || !blob) {
    console.warn(`  ✗ ${row.item_name} — download failed: ${error?.message ?? 'no data'}`)
    return null
  }

  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
  const mime = blob.type || 'image/jpeg'

  const response = await withRetry(row.item_name, () =>
    openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            { type: 'text', text: `${PROMPT}\n\nThe user logged this as: "${row.item_name}".` },
          ],
        },
      ],
      max_tokens: 200,
    })
  )

  const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
  if (!Array.isArray(parsed.visible)) return null

  const parts = parsed.visible
    .map((v: unknown) => String(v).toLowerCase().replace(/\s+/g, ' ').trim())
    .filter((s: string) => s && s.length <= 60)

  const deduped = Array.from(new Set<string>(parts)).slice(0, 20)
  return deduped.length > 0 ? deduped.join(', ') : null
}

async function run() {
  let query = supabase
    .from('food_logs')
    .select('id, item_name, storage_path, search_text')
    .not('storage_path', 'is', null)
    .order('date', { ascending: false })
    .limit(limit)

  if (!force) query = query.is('search_text', null)

  const { data, error } = await query
  if (error) {
    console.error(error)
    process.exit(1)
  }

  const rows = (data ?? []) as Row[]
  console.log(`${rows.length} photo meal${rows.length === 1 ? '' : 's'} to index${force ? ' (forced)' : ''}\n`)
  if (rows.length === 0) return

  let done = 0
  let failed = 0
  let cursor = 0

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++]
      try {
        const searchText = await describe(row)
        if (!searchText) {
          failed++
          continue
        }
        const { error: updateError } = await supabase
          .from('food_logs')
          .update({ search_text: searchText })
          .eq('id', row.id)
        if (updateError) {
          console.warn(`  ✗ ${row.item_name} — update failed: ${updateError.message}`)
          failed++
          continue
        }
        done++
        console.log(`  ✓ ${row.item_name} → ${searchText}`)
      } catch (err) {
        failed++
        console.warn(`  ✗ ${row.item_name} — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\nIndexed ${done}, failed ${failed}.`)
}

run()
