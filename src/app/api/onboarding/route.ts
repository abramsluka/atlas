import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Marks onboarding done. Called both when the wizard is finished and when it is
// skipped — either way the user has made their choice and must never be dropped
// back into setup on their next visit.
//
// Upsert, not update: user_settings rows are created out-of-band for hand-made
// accounts, so the row is not guaranteed to exist yet.
export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { error } = await db
    .from('user_settings')
    .upsert(
      { user_id: user.id, onboarding_completed_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
