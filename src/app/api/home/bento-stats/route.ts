export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { computeBentoStats } from '@/lib/home/bentoStats'

// Re-export so existing importers of this path keep working.
export type { BentoStats } from '@/lib/home/bentoStats'

export async function GET() {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const tz = await getUserTimezone(user.id)
    const today = toLocalDate(tz)

    const stats = await computeBentoStats(db, user.id, today)
    return NextResponse.json(stats)
  } catch (err) {
    console.error('[bento-stats] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
