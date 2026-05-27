import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { date, source, amount_mg } = await req.json()
  if (!date || !source || typeof amount_mg !== 'number') {
    return NextResponse.json({ error: 'date, source, and amount_mg are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('caffeine_logs')
    .insert({ user_id: user.id, date, source, amount_mg })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
