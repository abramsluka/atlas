import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { config, exercises, logs } = await req.json()
  const db = createServiceClient()

  if (config) {
    await db.from('gym_config').upsert(
      { ...config, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
  }

  if (exercises?.length) {
    await db.from('gym_exercises').delete().eq('user_id', user.id)
    await db.from('gym_exercises').insert(
      exercises.map((e: Record<string, unknown>) => ({ ...e, user_id: user.id }))
    )
  }

  if (logs?.length) {
    await db.from('po_logs').delete().eq('user_id', user.id)
    await db.from('po_logs').insert(
      logs.map((l: Record<string, unknown>) => ({ ...l, user_id: user.id }))
    )
  }

  return NextResponse.json({ ok: true })
}
