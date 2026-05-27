import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { supplement_id, date, time_slot } = await req.json()
  if (!supplement_id || !date || !time_slot) {
    return NextResponse.json({ error: 'supplement_id, date, and time_slot are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('supplement_logs')
    .insert({ user_id: user.id, supplement_id, date, time_slot })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
