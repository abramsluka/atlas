export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Log (or reset) a whole day at once. Body: { date: 'YYYY-MM-DD', completed }
// Applies to MANUAL habits only — auto habits (Water) derive themselves, so
// "log all" shouldn't fabricate an override for them.
export async function POST(request: NextRequest) {
  try {
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
    const { data: manual } = await db
      .from('habits').select('id').eq('user_id', user.id).eq('active', true).eq('kind', 'manual')
    const ids = (manual ?? []).map((h) => h.id as string)
    if (!ids.length) return NextResponse.json({ ok: true, count: 0 })

    if (completed) {
      const rows = ids.map((habit_id) => ({ user_id: user.id, habit_id, date, completed: true }))
      const { error } = await db.from('habit_completions').upsert(rows, { onConflict: 'user_id,habit_id,date' })
      if (error) throw error
    } else {
      const { error } = await db
        .from('habit_completions')
        .delete().eq('user_id', user.id).eq('date', date).in('habit_id', ids)
      if (error) throw error
    }

    return NextResponse.json({ ok: true, count: ids.length })
  } catch (err) {
    console.error('[habits/log-all] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
