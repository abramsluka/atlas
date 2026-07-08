export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { computeHabits } from '@/lib/habits/compute'

export type { HabitView, HabitDay } from '@/lib/habits/compute'

export async function GET() {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const tz = await getUserTimezone(user.id)

    const habits = await computeHabits(db, user.id, tz)
    return NextResponse.json({ habits })
  } catch (err) {
    console.error('[habits] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
