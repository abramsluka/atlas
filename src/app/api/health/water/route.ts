import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { date, amount_oz } = await req.json()
  if (!date || typeof amount_oz !== 'number') {
    return NextResponse.json({ error: 'date and amount_oz are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('water_logs')
    .insert({ user_id: user.id, date, amount_oz })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
