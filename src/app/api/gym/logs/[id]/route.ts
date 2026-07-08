import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { laDateKey, syncGymSession } from '@/lib/gymSessions'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  // Grab the set's day before deleting so we can recompute that day's session.
  const { data: existing } = await db
    .from('gym_logs')
    .select('logged_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  const { error } = await db
    .from('gym_logs')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing?.logged_at) {
    try {
      await syncGymSession(db, user.id, laDateKey(existing.logged_at))
    } catch (e) {
      console.error('gym session sync failed', e)
    }
  }

  return NextResponse.json({ ok: true })
}
