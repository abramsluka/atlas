import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { MealIngredientsSchema } from '@/features/food/mealSchema'
import { mealTotals, mealPortionDesc } from '@/features/food/mealMath'
import { logFoodServer } from '@/features/food/logFoodServer'

const LogSchema = z.object({
  name: z.string().min(1).max(80),
  ingredients: MealIngredientsSchema,
  // Set when re-logging a saved meal → bumps its use_count
  saved_meal_id: z.string().uuid().nullable().optional(),
  // Set to also save this composition as a reusable meal
  save_as: z
    .object({ name: z.string().min(1).max(60), emoji: z.string().max(8).nullable().optional() })
    .nullable()
    .optional(),
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Log a composed meal: totals recomputed server-side (pure math, no AI),
// water + caffeine side effects via logFoodServer, use_count bumps for the
// personal ingredient layer and the saved meal being re-logged.
export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = LogSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { name, ingredients, saved_meal_id, save_as } = parsed.data
  const totals = mealTotals(ingredients)

  const db = createServiceClient()
  const result = await logFoodServer(db, user.id, {
    item_name: name,
    calories: totals.cal,
    protein_g: totals.protein,
    carbs_g: totals.carbs,
    portion_desc: mealPortionDesc(ingredients),
    is_hydrating: totals.volume_oz != null,
    volume_oz: totals.volume_oz,
    caffeine_mg: totals.caffeine_mg,
    barcode: null,
    brand: null,
    confidence: 'high',
    notes: null,
    source: 'meal',
    ingredients,
  })

  if (result.error || !result.entry) {
    return NextResponse.json({ error: result.error ?? 'insert failed' }, { status: 500 })
  }

  const now = new Date().toISOString()

  // Bump personal-layer ingredient usage (non-fatal, expression-free update
  // requires a read first)
  const customIds = ingredients
    .map(i => i.ref)
    .filter((r): r is string => r != null && UUID_RE.test(r))
  if (customIds.length > 0) {
    const { data: rows } = await db
      .from('user_ingredients')
      .select('id, use_count')
      .eq('user_id', user.id)
      .in('id', customIds)
    for (const row of rows ?? []) {
      await db
        .from('user_ingredients')
        .update({ use_count: row.use_count + 1, last_used_at: now })
        .eq('id', row.id)
    }
  }

  // Re-log of a saved meal → bump it
  if (saved_meal_id) {
    const { data: meal } = await db
      .from('saved_meals')
      .select('id, use_count')
      .eq('id', saved_meal_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (meal) {
      await db
        .from('saved_meals')
        .update({ use_count: meal.use_count + 1, last_used_at: now })
        .eq('id', meal.id)
    }
  }

  // Optionally persist the composition as a reusable meal
  let savedMeal = null
  if (save_as) {
    const { data } = await db
      .from('saved_meals')
      .upsert(
        {
          user_id: user.id,
          name: save_as.name,
          emoji: save_as.emoji ?? null,
          ingredients,
          calories: totals.cal,
          protein_g: totals.protein,
          carbs_g: totals.carbs,
          total_grams: totals.grams,
          last_used_at: now,
        },
        { onConflict: 'user_id,name' }
      )
      .select()
      .single()
    savedMeal = data
  }

  return NextResponse.json(
    {
      ...result.entry,
      photo_url: null,
      water_logged: result.waterLogged,
      caffeine_logged: result.caffeineLogged,
      caffeine_mg: totals.caffeine_mg,
      volume_oz: totals.volume_oz,
      saved_meal: savedMeal,
    },
    { status: 201 }
  )
}
