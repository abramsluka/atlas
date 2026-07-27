import type { SupabaseClient } from '@supabase/supabase-js'
import { toLocalDate } from '@/lib/date'
import { getUserTimezone } from '@/lib/getUserTimezone'

export interface LogFoodInput {
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  portion_desc: string
  is_hydrating: boolean
  volume_oz: number | null
  // Estimated caffeine dose in mg (0/absent for non-caffeinated). > 0 → also
  // logs a caffeine_logs dose so the caffeine/energy page stays in sync.
  caffeine_mg?: number | null
  barcode: string | null
  brand: string | null
  confidence: 'low' | 'medium' | 'high'
  notes: string | null
  source: 'text' | 'drink' | 'barcode' | 'meal'
  // Composed-meal ingredient snapshot (source 'meal' only)
  ingredients?: unknown
  // Explicit emoji override; null lets the app resolve one from the name
  emoji?: string | null
}

export interface LogFoodResult {
  entry: Record<string, unknown> | null
  waterLogged: boolean
  caffeineLogged: boolean
  error: string | null
}

// Core manual food insert, shared by the /api/health/food/log route and the MCP
// log_food tool: 3 AM day boundary in the user's timezone (never the server
// clock — Vercel runs UTC), hydrating-drink → water_logs side effect and
// caffeinated-drink → caffeine_logs side effect (both non-fatal), food_items
// frequents upsert (non-fatal). Callers validate and coerce inputs; this only writes.
export async function logFoodServer(
  db: SupabaseClient,
  userId: string,
  input: LogFoodInput
): Promise<LogFoodResult> {
  const now = new Date()
  const date = toLocalDate(await getUserTimezone(userId))

  const { data: inserted, error: insertError } = await db
    .from('food_logs')
    .insert({
      user_id: userId,
      date,
      storage_path: null,
      item_name: input.item_name,
      calories: input.calories,
      protein_g: input.protein_g,
      carbs_g: input.carbs_g,
      confidence: input.confidence,
      notes: input.notes,
      source: input.source,
      barcode: input.barcode,
      volume_oz: input.volume_oz,
      ingredients: input.ingredients ?? null,
      emoji: input.emoji ?? null,
      taken_at: now.toISOString(),
    })
    .select()
    .single()

  if (insertError) return { entry: null, waterLogged: false, caffeineLogged: false, error: insertError.message }

  // Hydrating drink → also log water (non-fatal if it fails)
  let waterLogged = false
  if (input.is_hydrating && input.volume_oz != null && input.volume_oz > 0) {
    const { error: waterError } = await db
      .from('water_logs')
      .insert({ user_id: userId, date, amount_oz: input.volume_oz })
    if (waterError) console.error('[food/log] water insert failed:', waterError.message)
    else waterLogged = true
  }

  // Caffeinated drink → also log a caffeine dose so the caffeine/energy page
  // reflects it (non-fatal if it fails). logged_at mirrors the food's taken_at
  // so it lands at the right hour on the energy curve.
  let caffeineLogged = false
  if (input.caffeine_mg != null && input.caffeine_mg > 0) {
    const { error: caffeineError } = await db
      .from('caffeine_logs')
      .insert({
        user_id: userId,
        date,
        source: input.item_name,
        amount_mg: Math.round(input.caffeine_mg),
        logged_at: now.toISOString(),
      })
    if (caffeineError) console.error('[food/log] caffeine insert failed:', caffeineError.message)
    else caffeineLogged = true
  }

  // Composed meals live in saved_meals, not the frequents library — the
  // food_items source check would reject 'meal' anyway.
  if (input.source === 'meal') {
    return { entry: inserted as Record<string, unknown>, waterLogged, caffeineLogged, error: null }
  }

  // Upsert frequents library: bump use_count + last_used_at on repeat logs
  const { data: existingItem } = await db
    .from('food_items')
    .select('id, use_count')
    .eq('user_id', userId)
    .eq('name', input.item_name)
    .eq('portion_desc', input.portion_desc)
    .maybeSingle()

  if (existingItem) {
    await db
      .from('food_items')
      .update({
        use_count: existingItem.use_count + 1,
        last_used_at: now.toISOString(),
        calories: input.calories,
        protein_g: input.protein_g,
        carbs_g: input.carbs_g,
        volume_oz: input.volume_oz,
        is_hydrating: input.is_hydrating,
      })
      .eq('id', existingItem.id)
  } else {
    const { error: itemError } = await db.from('food_items').insert({
      user_id: userId,
      name: input.item_name,
      brand: input.brand,
      barcode: input.barcode,
      source: input.source,
      calories: input.calories,
      protein_g: input.protein_g,
      carbs_g: input.carbs_g,
      portion_desc: input.portion_desc,
      volume_oz: input.volume_oz,
      is_hydrating: input.is_hydrating,
      emoji: input.emoji ?? null,
    })
    if (itemError) console.error('[food/log] food_items insert failed:', itemError.message)
  }

  return { entry: inserted as Record<string, unknown>, waterLogged, caffeineLogged, error: null }
}
