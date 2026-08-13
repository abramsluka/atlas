import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const MAX_RESULTS = 50

// Full-text search across the whole food history — matches the meal name, the
// vision model's list of what was actually in the photo (search_text), notes,
// the user's own description, and composed-meal ingredient names.
export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120)
  if (q.length < 2) return NextResponse.json({ results: [], stats: null })

  const db = createServiceClient()
  const { data, error } = await db.rpc('search_food_logs', {
    p_user_id: user.id,
    p_query: q,
    p_limit: MAX_RESULTS,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Record<string, unknown>[]

  // One batched signing call rather than one per hit.
  const paths = rows.map(r => r.storage_path).filter((p): p is string => typeof p === 'string')
  const signed = new Map<string, string>()
  if (paths.length > 0) {
    const { data: urls } = await db.storage.from('food-photos').createSignedUrls(paths, 3600)
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl)
    }
  }

  const results: Record<string, unknown>[] = rows.map(row => {
    // search_tsv is an index artifact — never worth shipping to the client.
    const { search_tsv: _ignored, ...log } = row
    const path = typeof log.storage_path === 'string' ? log.storage_path : null
    return { ...log, photo_url: path ? signed.get(path) ?? null : null }
  })

  const calorieValues = results
    .map(r => Number(r.calories))
    .filter(c => Number.isFinite(c) && c > 0)
  const dates = results.map(r => String(r.date)).sort()

  return NextResponse.json({
    results,
    stats: {
      count: results.length,
      capped: results.length === MAX_RESULTS,
      avg_calories: calorieValues.length
        ? Math.round(calorieValues.reduce((a, b) => a + b, 0) / calorieValues.length)
        : null,
      first_date: dates[0] ?? null,
      last_date: dates[dates.length - 1] ?? null,
    },
  })
}
