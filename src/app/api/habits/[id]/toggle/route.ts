export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Tick or un-tick a habit for a given local day.
//   { date: 'YYYY-MM-DD', completed: true }  → upsert a completion row
//   { date: 'YYYY-MM-DD', completed: false } → delete it (absence = not done)
// On an auto habit a completed=true row is a manual override that unions in;
// completed=false only removes a prior manual tick, it can't erase a real
// source-derived day (that genuinely happened).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const date = body?.date as string | undefined
    const completed = body?.completed
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'date (YYYY-MM-DD) and completed (boolean) required' }, { status: 400 })
    }

    const db = createServiceClient()

    // Make sure the habit is the caller's before writing.
    const { data: habit } = await db
      .from('habits').select('id').eq('id', id).eq('user_id', user.id).maybeSingle()
    if (!habit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (completed) {
      const { error } = await db
        .from('habit_completions')
        .upsert({ user_id: user.id, habit_id: id, date, completed: true }, { onConflict: 'user_id,habit_id,date' })
      if (error) throw error
    } else {
      const { error } = await db
        .from('habit_completions')
        .delete().eq('user_id', user.id).eq('habit_id', id).eq('date', date)
      if (error) throw error
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[habits/toggle] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
