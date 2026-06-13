import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: logRow, error: fetchError } = await db
    .from('food_logs')
    .select('user_id, item_name, calories, protein_g, carbs_g, fat_g, notes')
    .eq('id', id)
    .single()

  if (fetchError || !logRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (logRow.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const name = logRow.item_name
  const portion_desc = logRow.item_name
  const now = new Date().toISOString()

  const { data: existing } = await db
    .from('food_items')
    .select('id, use_count')
    .eq('user_id', user.id)
    .eq('name', name)
    .eq('portion_desc', portion_desc)
    .maybeSingle()

  if (existing) {
    // Toggle: already favorited — remove it
    const { error: deleteError } = await db
      .from('food_items')
      .delete()
      .eq('id', existing.id)
    if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
    return NextResponse.json({ ok: true, favorited: false })
  }

  // Not yet favorited — add it
  const { error: insertError } = await db.from('food_items').insert({
    user_id: user.id,
    name,
    source: 'photo',
    calories: logRow.calories,
    protein_g: logRow.protein_g ?? 0,
    carbs_g: logRow.carbs_g ?? 0,
    fat_g: logRow.fat_g,
    portion_desc,
    is_hydrating: false,
  })
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ ok: true, favorited: true })
}
