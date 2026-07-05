import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { userIdFromSyncToken } from '@/lib/appleAuth'

export const runtime = 'nodejs'

// GET — data for the write-back Shortcut to push into Apple Health:
// latest logged body weight + today's nutrition totals.
export async function GET(req: NextRequest) {
  const userId = await userIdFromSyncToken(req)
  if (!userId) return NextResponse.json({ error: 'Invalid or missing sync token' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(userId)
  const today = toLocalDate(tz)

  const [weightRes, profileRes, foodRes] = await Promise.all([
    db.from('body_weights').select('date_key, weight').eq('user_id', userId).order('date_key', { ascending: false }).limit(1).maybeSingle(),
    db.from('health_profile').select('weight_unit').eq('user_id', userId).maybeSingle(),
    db.from('food_logs').select('calories, protein_g').eq('user_id', userId).eq('date', today),
  ])

  const w = weightRes.data as { date_key: string; weight: number } | null
  const unit = ((profileRes.data as { weight_unit: string | null } | null)?.weight_unit) === 'kg' ? 'kg' : 'lbs'
  const food = (foodRes.data ?? []) as Array<{ calories: number | null; protein_g: number | null }>

  return NextResponse.json({
    body_weight: w ? { value: w.weight, unit, date: w.date_key } : null,
    nutrition: {
      date: today,
      calories: Math.round(food.reduce((s, f) => s + (f.calories ?? 0), 0)),
      protein_g: Math.round(food.reduce((s, f) => s + (f.protein_g ?? 0), 0)),
    },
  })
}
