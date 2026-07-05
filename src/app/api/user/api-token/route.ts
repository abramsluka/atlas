import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// GET — return the current sync token (so the settings UI can show it).
export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data } = await db.from('user_settings').select('sync_token, sync_token_created_at').eq('user_id', user.id).maybeSingle()
  return NextResponse.json({ token: data?.sync_token ?? null, created_at: data?.sync_token_created_at ?? null })
}

// POST — generate (or regenerate) the sync token.
export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = 'atlas_' + randomBytes(24).toString('hex')
  const db = createServiceClient()
  const { error } = await db
    .from('user_settings')
    .upsert({ user_id: user.id, sync_token: token, sync_token_created_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ token })
}
