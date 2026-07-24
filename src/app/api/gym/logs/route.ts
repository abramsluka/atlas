import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { laDateKey, syncGymSession } from '@/lib/gymSessions'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const exerciseId = url.searchParams.get('exercise_id')

  const db = createServiceClient()
  let query = db
    .from('gym_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('logged_at')

  if (exerciseId) query = query.eq('exercise_id', exerciseId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const db = createServiceClient()

  // The referenced exercise must belong to the caller
  if (body.exercise_id) {
    const { data: owned } = await db
      .from('gym_exercises')
      .select('id')
      .eq('id', body.exercise_id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!owned) return NextResponse.json({ error: 'Unknown exercise' }, { status: 404 })
  }

  const { data, error } = await db
    .from('gym_logs')
    .insert({ ...body, user_id: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Keep the day's workout session (start/end time) in sync with its set logs.
  try {
    await syncGymSession(db, user.id, laDateKey(data.logged_at))
  } catch (e) {
    console.error('gym session sync failed', e)
  }

  return NextResponse.json(data)
}
