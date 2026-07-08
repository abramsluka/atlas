import type { SupabaseClient } from '@supabase/supabase-js'
import { rolledDate } from '@/features/food/date'

export interface LogFoodInput {
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  portion_desc: string
  is_hydrating: boolean
  volume_oz: number | null
  barcode: string | null
  brand: string | null
  confidence: 'low' | 'medium' | 'high'
  notes: string | null
  source: 'text' | 'drink' | 'barcode'
}

export interface LogFoodResult {
  entry: Record<string, unknown> | null
  waterLogged: boolean
  error: string | null
}

// Core manual food insert, shared by the /api/health/food/log route and the MCP
// log_food tool: rolledDate day boundary, hydrating-drink → water_logs side
// effect (non-fatal), food_items frequents upsert (non-fatal). Callers validate
// and coerce inputs; this only writes.
export async function logFoodServer(
  db: SupabaseClient,
  userId: string,
  input: LogFoodInput
): Promise<LogFoodResult> {
  const now = new Date()
  const date = rolledDate(now)

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
      taken_at: now.toISOString(),
    })
    .select()
    .single()

  if (insertError) return { entry: null, waterLogged: false, error: insertError.message }

  // Hydrating drink → also log water (non-fatal if it fails)
  let waterLogged = false
  if (input.is_hydrating && input.volume_oz != null && input.volume_oz > 0) {
    const { error: waterError } = await db
      .from('water_logs')
      .insert({ user_id: userId, date, amount_oz: input.volume_oz })
    if (waterError) console.error('[food/log] water insert failed:', waterError.message)
    else waterLogged = true
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
    })
    if (itemError) console.error('[food/log] food_items insert failed:', itemError.message)
  }

  return { entry: inserted as Record<string, unknown>, waterLogged, error: null }
}
