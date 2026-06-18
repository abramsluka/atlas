export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeStreaks } from '@/lib/home/streaks'

// Re-export so importers of this path keep working.
export type { Streaks } from '@/lib/home/streaks'

export async function GET() {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const tz = await getUserTimezone(user.id)

    const streaks = await computeStreaks(db, user.id, tz)
    return NextResponse.json(streaks)
  } catch (err) {
    console.error('[streaks] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
