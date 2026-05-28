import { NextResponse } from 'next/server'
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
  upgrade_at_reps_auto: false,
}

export async function DELETE() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  await Promise.all([
    db.from('gym_exercises').delete().eq('user_id', user.id),
    db.from('po_logs').delete().eq('user_id', user.id),
  ])
  await db.from('gym_config').upsert(
    { ...DEFAULT_CONFIG, user_id: user.id, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  return NextResponse.json({ ok: true })
}
