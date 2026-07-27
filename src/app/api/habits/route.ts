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

// Create a manual habit. Body: { name, emoji?, perWeek }
export async function POST(request: Request) {
  try {
    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const emoji = typeof body?.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : '✅'
    const perWeek = Number(body?.perWeek)
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 7) {
      return NextResponse.json({ error: 'perWeek must be an integer 1..7' }, { status: 400 })
    }

    const db = createServiceClient()
    // Append after the user's current last habit so it lands at the bottom.
    const { data: last } = await db
      .from('habits')
      .select('order_index')
      .eq('user_id', user.id).eq('active', true)
      .order('order_index', { ascending: false })
      .limit(1).maybeSingle()
    const orderIndex = (last?.order_index ?? -1) + 1

    const { data, error } = await db
      .from('habits')
      .insert({
        user_id: user.id,
        name,
        emoji,
        kind: 'manual',
        cadence: { per_week: perWeek },
        order_index: orderIndex,
        active: true,
      })
      .select('id')
      .single()
    if (error) throw error

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    console.error('[habits/post] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
