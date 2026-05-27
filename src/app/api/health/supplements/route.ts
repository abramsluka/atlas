import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, dose, notes, times, running_low, order_index } = await req.json()
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('supplements')
    .insert({
      user_id: user.id,
      name: name.trim(),
      dose: dose?.trim() || null,
      notes: notes?.trim() || null,
      times: Array.isArray(times) ? times : [],
      running_low: running_low ?? false,
      order_index: typeof order_index === 'number' ? order_index : 0,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
