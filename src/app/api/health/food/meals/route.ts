import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MealIngredientsSchema } from '@/features/food/mealSchema'
import { mealTotals } from '@/features/food/mealMath'

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
  emoji: z.string().max(8).nullable().optional(),
  ingredients: MealIngredientsSchema,
})

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('saved_meals')
    .select('*')
    .eq('user_id', user.id)
    .order('last_used_at', { ascending: false })
    .limit(100)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Create (or overwrite by name) a saved meal. Totals are recomputed
// server-side from the ingredient snapshot — never trusted from the client.
export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = CreateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { name, emoji, ingredients } = parsed.data
  const totals = mealTotals(ingredients)

  const db = createServiceClient()
  const { data, error } = await db
    .from('saved_meals')
    .upsert(
      {
        user_id: user.id,
        name,
        emoji: emoji ?? null,
        ingredients,
        calories: totals.cal,
        protein_g: totals.protein,
        carbs_g: totals.carbs,
        total_grams: totals.grams,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,name' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
