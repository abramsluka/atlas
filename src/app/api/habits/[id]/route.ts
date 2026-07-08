export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Edit a habit's weekly goal. Body: { perWeek: 1..7 }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const perWeek = Number(body?.perWeek)
    if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 7) {
      return NextResponse.json({ error: 'perWeek must be an integer 1..7' }, { status: 400 })
    }

    const db = createServiceClient()
    const { data, error } = await db
      .from('habits')
      .update({ cadence: { per_week: perWeek } })
      .eq('id', id).eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[habits/patch] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
