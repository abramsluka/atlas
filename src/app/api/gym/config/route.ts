import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const DEFAULT_CONFIG = {
  gyms: [{ id: 'g_default', name: 'Gym' }],
  days: [
    { id: 'd_push', name: 'Push' },
    { id: 'd_pull', name: 'Pull' },
    { id: 'd_legs', name: 'Legs' },
  ],
  split_rotation: ['Push', 'Pull', 'Legs', 'Rest'],
  split_anchor: null,
  units: 'lbs',
  upgrade_at_reps: 12,
}

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data } = await db
    .from('gym_config')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json(data ?? { ...DEFAULT_CONFIG, user_id: user.id })
}

export async function PUT(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = createServiceClient()
  const { data, error } = await db
    .from('gym_config')
    .upsert(
      { ...body, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
