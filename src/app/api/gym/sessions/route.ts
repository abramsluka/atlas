import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { SESSION_IDLE_MS } from '@/features/gym/sessionSignal'

export async function GET(_req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('gym_sessions')
    .select('*')
    .eq('user_id', user.id)
    .order('date_key', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// Finish Workout — the server-side marker that a session is over. Until this
// lands, the day is "in progress": the training streak withholds credit and the
// AI coaches know he's mid-set. Logging another set afterwards reopens the
// session (see syncGymSession), so this is a toggle, not a one-way door.
export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { date_key, finished } = (await req.json()) as { date_key?: string; finished?: boolean }
  if (!date_key) return NextResponse.json({ error: 'date_key is required' }, { status: 400 })

  const db = createServiceClient()
  const finishedAt = finished === false ? null : new Date().toISOString()

  const update = (key: string) =>
    db
      .from('gym_sessions')
      .update({ finished_at: finishedAt })
      .eq('user_id', user.id)
      .eq('date_key', key)
      .select()
      .maybeSingle()

  const { data, error } = await update(date_key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data) return NextResponse.json(data)

  // The client's "today" runs on the user's timezone with a 3 AM rollover while
  // date_key is the raw LA calendar day, so the two disagree between midnight
  // and 3 AM. Rather than 404 a late-night workout, fall back to the newest
  // session — but only while it's still the one he could be in.
  const { data: latest } = await db
    .from('gym_sessions')
    .select('date_key, ended_at')
    .eq('user_id', user.id)
    .order('date_key', { ascending: false })
    .limit(1)
    .maybeSingle()

  const recent =
    latest && Date.now() - new Date(latest.ended_at).getTime() < SESSION_IDLE_MS
  if (!recent) return NextResponse.json({ error: 'No session for that day' }, { status: 404 })

  const { data: fallback, error: fallbackErr } = await update(latest.date_key)
  if (fallbackErr) return NextResponse.json({ error: fallbackErr.message }, { status: 500 })
  if (!fallback) return NextResponse.json({ error: 'No session for that day' }, { status: 404 })
  return NextResponse.json(fallback)
}
