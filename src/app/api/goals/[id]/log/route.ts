import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const db = createServiceClient()

  const { error } = await db.from('habit_logs').insert({
    user_id: user.id,
    goal_id: id,
    date: today,
  })

  if (error && !error.message.includes('duplicate key') && !error.code?.includes('23505')) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const db = createServiceClient()

  const { error } = await db
    .from('habit_logs')
    .delete()
    .eq('goal_id', id)
    .eq('user_id', user.id)
    .eq('date', today)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
