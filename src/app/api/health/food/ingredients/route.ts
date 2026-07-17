import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { UserIngredientInputSchema } from '@/features/food/mealSchema'

// Personal ingredient layer (per-100g macros). The bundled library ships in
// app code; barcode scans and manual adds land here.

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('user_ingredients')
    .select('*')
    .eq('user_id', user.id)
    .order('last_used_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = UserIngredientInputSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const input = parsed.data

  const db = createServiceClient()
  const { data, error } = await db
    .from('user_ingredients')
    .upsert(
      {
        user_id: user.id,
        name: input.name,
        brand: input.brand ?? null,
        barcode: input.barcode ?? null,
        cal_per_100: input.cal_per_100,
        protein_per_100: input.protein_per_100,
        carbs_per_100: input.carbs_per_100,
        unit_name: input.unit_name ?? null,
        unit_grams: input.unit_grams ?? null,
        liquid: input.liquid ?? false,
        hydrating: input.hydrating ?? false,
        caffeine_per_100: input.caffeine_per_100 ?? null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,name' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
