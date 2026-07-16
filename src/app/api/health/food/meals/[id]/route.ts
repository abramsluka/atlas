import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MealIngredientsSchema } from '@/features/food/mealSchema'
import { mealTotals } from '@/features/food/mealMath'

const UpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  emoji: z.string().max(8).nullable().optional(),
  ingredients: MealIngredientsSchema.optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name != null) updates.name = parsed.data.name
  if (parsed.data.emoji !== undefined) updates.emoji = parsed.data.emoji
  if (parsed.data.ingredients) {
    const totals = mealTotals(parsed.data.ingredients)
    updates.ingredients = parsed.data.ingredients
    updates.calories = totals.cal
    updates.protein_g = totals.protein
    updates.carbs_g = totals.carbs
    updates.total_grams = totals.grams
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('saved_meals')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { error } = await db
    .from('saved_meals')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
