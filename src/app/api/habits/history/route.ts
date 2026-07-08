export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeHabitHistory } from '@/lib/habits/compute'

export type { HabitHistoryWeek } from '@/lib/habits/compute'

export async function GET() {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const tz = await getUserTimezone(user.id)

    const weeks = await computeHabitHistory(db, user.id, tz)
    return NextResponse.json({ weeks })
  } catch (err) {
    console.error('[habits/history] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
