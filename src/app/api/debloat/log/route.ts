import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, daysAgoLocal } from '@/lib/date'

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { searchParams } = new URL(request.url)
  const history = searchParams.get('history') === 'true'
  const tz = await getUserTimezone(user.id)
  const date = searchParams.get('date') ?? toLocalDate(tz)

  if (history) {
    const cutoff = daysAgoLocal(14, tz)
    const { data, error } = await db
      .from('debloat_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', cutoff)
      .order('date', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data ?? [])
  }

  const { data, error } = await db
    .from('debloat_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { date, bloat_level, checklist, notes } = body

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const db = createServiceClient()

  const { data, error } = await db
    .from('debloat_logs')
    .upsert(
      {
        user_id: user.id,
        date,
        ...(bloat_level !== undefined && { bloat_level }),
        ...(checklist !== undefined && { checklist }),
        ...(notes !== undefined && { notes }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
