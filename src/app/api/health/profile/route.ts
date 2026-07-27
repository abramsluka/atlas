import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ALLOWED_FIELDS = [
  'weight_lbs', 'daily_water_target_oz', 'age', 'sex', 'height_cm',
  'activity_hrs_per_week', 'caffeine_mg_per_day',
  'water_unit', 'bottle_ml', 'glass_ml', 'weight_unit', 'substances',
  'target_weight_lbs', 'cut_pace', 'fitness_goal', 'activity_level',
  'daily_calorie_target', 'daily_protein_target_g', 'daily_carbs_target_g',
  'target_reasoning', 'target_calc_weight_lbs', 'target_calculated_at',
  'linked_target_goal_id', 'show_oura', 'show_apple_watch',
]

export async function PATCH(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const updates: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  }
  ALLOWED_FIELDS.forEach(f => {
    if (f in body) updates[f] = body[f]
  })

  const db = createServiceClient()
  const { data, error } = await db
    .from('health_profile')
    .upsert(updates, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
