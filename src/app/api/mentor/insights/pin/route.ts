import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// POST { insight_id, pinned } — pin or unpin an insight.
export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { insight_id, pinned } = await req.json() as { insight_id?: string; pinned?: boolean }
  if (!insight_id) return NextResponse.json({ error: 'insight_id required' }, { status: 400 })

  const db = createServiceClient()
  if (pinned) {
    const { error } = await db
      .from('insight_pins')
      .upsert({ user_id: user.id, insight_id }, { onConflict: 'user_id,insight_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db
      .from('insight_pins')
      .delete()
      .eq('user_id', user.id)
      .eq('insight_id', insight_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
