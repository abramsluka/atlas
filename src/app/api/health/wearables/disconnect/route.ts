import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Disconnect a wearable: drops the OAuth token row (history in wearable_data
// is kept). Body: { provider: 'oura' | 'whoop' | 'fitbit' | 'all' }.
export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const provider = body?.provider
  if (provider !== 'oura' && provider !== 'whoop' && provider !== 'fitbit' && provider !== 'all') {
    return NextResponse.json({ error: 'provider must be oura, whoop, fitbit, or all' }, { status: 400 })
  }

  const db = createServiceClient()
  let q = db.from('wearable_tokens').delete().eq('user_id', user.id)
  if (provider !== 'all') q = q.eq('provider', provider)
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
