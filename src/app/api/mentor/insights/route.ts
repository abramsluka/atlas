export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeCorrelations, type Insight } from '@/lib/computeCorrelations'

export interface InsightsResponse {
  insights: Insight[]
  pinnedIds: string[]
}

export async function GET() {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const tz = await getUserTimezone(user.id)

    const insights = await computeCorrelations(db, user.id, tz)

    // Pins are best-effort — isolate so a missing table (migration not yet
    // applied) never breaks the whole tab.
    let pinnedIds: string[] = []
    try {
      const pinsRes = await db.from('insight_pins').select('insight_id').eq('user_id', user.id)
      if (!pinsRes.error) pinnedIds = ((pinsRes.data as { insight_id: string }[] | null) ?? []).map(p => p.insight_id)
    } catch { /* table may not exist yet */ }

    const res: InsightsResponse = { insights, pinnedIds }
    return NextResponse.json(res)
  } catch (err) {
    console.error('[mentor/insights] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
