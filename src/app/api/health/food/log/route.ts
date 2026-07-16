import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logFoodServer } from '@/features/food/logFoodServer'

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
  const caffeine_mg = body.caffeine_mg != null ? Math.max(0, Math.round(Number(body.caffeine_mg)) || 0) : 0
  const barcode = body.barcode ? String(body.barcode).slice(0, 32) : null
  const brand = body.brand ? String(body.brand).slice(0, 80) : null
  const confidence = ['low', 'medium', 'high'].includes(body.confidence) ? body.confidence : 'medium'
  const notes = body.notes ? String(body.notes) : null

  if (!item_name || !Number.isFinite(calories)) {
    return NextResponse.json({ error: 'item_name and calories are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const result = await logFoodServer(db, user.id, {
    item_name,
    calories,
    protein_g,
    carbs_g,
    portion_desc,
    is_hydrating,
    volume_oz,
    caffeine_mg,
    barcode,
    brand,
    confidence,
    notes,
    source,
  })

  if (result.error || !result.entry) {
    return NextResponse.json({ error: result.error ?? 'insert failed' }, { status: 500 })
  }

  return NextResponse.json({ ...result.entry, photo_url: null, water_logged: result.waterLogged, caffeine_logged: result.caffeineLogged }, { status: 201 })
}
