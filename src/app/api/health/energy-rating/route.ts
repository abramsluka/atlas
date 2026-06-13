import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const db = createServiceClient()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  // Count distinct days with logged ratings (last 30 days only)
  if (searchParams.get('count') === 'true') {
    const { data } = await db
      .from('energy_ratings')
      .select('date_key')
      .eq('user_id', user.id)
      .gte('date_key', thirtyDaysAgo)
    const count = new Set(data?.map((r: { date_key: string }) => r.date_key) ?? []).size
    return NextResponse.json({ count })
  }

  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data } = await db
    .from('energy_ratings')
    .select('*')
    .eq('user_id', user.id)
    .eq('date_key', date)
    .gte('date_key', thirtyDaysAgo)
    .order('logged_at', { ascending: true })

  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { rating, predicted, date_key } = body
  if (rating == null || !date_key) return NextResponse.json({ error: 'rating and date_key required' }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('energy_ratings')
    .insert({ user_id: user.id, rating, predicted: predicted ?? null, date_key })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
