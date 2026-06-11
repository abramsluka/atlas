import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rolledDate } from '@/features/food/date'

// Insert a manual (text/drink/barcode) food log. Hydrating drinks also log water.
export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const source: 'text' | 'drink' | 'barcode' =
    ['text', 'drink', 'barcode'].includes(body.source) ? body.source : 'text'
  const item_name = String(body.item_name ?? '').trim().slice(0, 80)
  const calories = Math.round(Number(body.calories))
  const protein_g = Number(body.protein_g) || 0
  const carbs_g = Number(body.carbs_g) || 0
  const portion_desc = String(body.portion_desc ?? '').trim().slice(0, 120) || item_name
  const is_hydrating = Boolean(body.is_hydrating)
  const volume_oz = is_hydrating && body.volume_oz != null ? Number(body.volume_oz) : null
  const barcode = body.barcode ? String(body.barcode).slice(0, 32) : null
  const brand = body.brand ? String(body.brand).slice(0, 80) : null
  const confidence = ['low', 'medium', 'high'].includes(body.confidence) ? body.confidence : 'medium'
  const notes = body.notes ? String(body.notes) : null

  if (!item_name || !Number.isFinite(calories)) {
    return NextResponse.json({ error: 'item_name and calories are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const now = new Date()
  const date = rolledDate(now)

  const { data: inserted, error: insertError } = await db
    .from('food_logs')
    .insert({
      user_id: user.id,
      date,
      storage_path: null,
      item_name,
      calories,
      protein_g,
      carbs_g,
      confidence,
      notes,
      source,
      barcode,
      volume_oz,
      taken_at: now.toISOString(),
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Hydrating drink → also log water (non-fatal if it fails)
  let waterLogged = false
  if (is_hydrating && volume_oz != null && volume_oz > 0) {
    const { error: waterError } = await db
      .from('water_logs')
      .insert({ user_id: user.id, date, amount_oz: volume_oz })
    if (waterError) console.error('[food/log] water insert failed:', waterError.message)
    else waterLogged = true
  }

  // Upsert frequents library: bump use_count + last_used_at on repeat logs
  const { data: existingItem } = await db
    .from('food_items')
    .select('id, use_count')
    .eq('user_id', user.id)
    .eq('name', item_name)
    .eq('portion_desc', portion_desc)
    .maybeSingle()

  if (existingItem) {
    await db
      .from('food_items')
      .update({
        use_count: existingItem.use_count + 1,
        last_used_at: now.toISOString(),
        calories,
        protein_g,
        carbs_g,
        volume_oz,
        is_hydrating,
      })
      .eq('id', existingItem.id)
  } else {
    const { error: itemError } = await db.from('food_items').insert({
      user_id: user.id,
      name: item_name,
      brand,
      barcode,
      source,
      calories,
      protein_g,
      carbs_g,
      portion_desc,
      volume_oz,
      is_hydrating,
    })
    if (itemError) console.error('[food/log] food_items insert failed:', itemError.message)
  }

  return NextResponse.json({ ...inserted, photo_url: null, water_logged: waterLogged }, { status: 201 })
}
