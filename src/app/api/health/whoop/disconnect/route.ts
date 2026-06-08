import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  await Promise.all([
    db.from('wearable_tokens').delete().eq('user_id', user.id).eq('provider', 'whoop'),
    db.from('wearable_data').delete().eq('user_id', user.id).eq('provider', 'whoop'),
  ])

  return NextResponse.json({ ok: true })
}
