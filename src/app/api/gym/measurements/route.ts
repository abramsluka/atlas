import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('body_measurements')
    .select('*')
    .eq('user_id', user.id)
    .order('date_key')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { date_key, neck_in, waist_in, hip_in, bf_pct } = await req.json()
  const db = createServiceClient()
  const { data, error } = await db
    .from('body_measurements')
    .upsert(
      { user_id: user.id, date_key, neck_in, waist_in, hip_in: hip_in ?? null, bf_pct },
      { onConflict: 'user_id,date_key' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
