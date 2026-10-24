import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

type Assignment = { id: string; gym_ids: string[]; day_ids: string[] }

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')

// Bulk day/gym assignment from the program grid: body { updates: Assignment[] }.
// Only gym_ids and day_ids are written — progression fields are never touched
// here (scoped to the authed user).
export async function PATCH(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { updates } = await req.json()
  if (
    !Array.isArray(updates) ||
    !updates.every((u: Assignment) => u && typeof u.id === 'string' && isStrArr(u.gym_ids) && isStrArr(u.day_ids))
  ) {
    return NextResponse.json({ error: 'updates must be [{ id, gym_ids, day_ids }]' }, { status: 400 })
  }

  const db = createServiceClient()
  const results = await Promise.all(
    (updates as Assignment[]).map(u =>
      db.from('gym_exercises')
        .update({ gym_ids: u.gym_ids, day_ids: u.day_ids })
        .eq('id', u.id)
        .eq('user_id', user.id)
    )
  )
  const failed = results.find(r => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
