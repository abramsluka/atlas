import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { timezone } = await req.json()
  if (!timezone || typeof timezone !== 'string') {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
  }

  const db = createServiceClient()
  await db.from('user_settings').upsert(
    { user_id: user.id, timezone, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )

  return NextResponse.json({ ok: true })
}
