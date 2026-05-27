import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { format, subDays } from 'date-fns'

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const daysParam = parseInt(request.nextUrl.searchParams.get('days') ?? '14', 10)
  const days = Math.min(Math.max(daysParam, 1), 90)
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd')

  const { data, error } = await db
    .from('food_logs')
    .select('date, calories, protein_g, carbs_g')
    .eq('user_id', user.id)
    .gte('date', since)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const byDate = new Map<string, { calories: number; protein_g: number; carbs_g: number; meal_count: number }>()

  for (const row of data ?? []) {
    const existing = byDate.get(row.date) ?? { calories: 0, protein_g: 0, carbs_g: 0, meal_count: 0 }
    existing.calories += row.calories ?? 0
    existing.protein_g += Number(row.protein_g ?? 0)
    existing.carbs_g += Number(row.carbs_g ?? 0)
    existing.meal_count += 1
    byDate.set(row.date, existing)
  }

  const result = Array.from(byDate.entries())
    .map(([date, totals]) => ({ date, ...totals }))
    .sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json(result)
}
