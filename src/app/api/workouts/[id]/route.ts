import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  const { data, error } = await db
    .from('workouts')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  revalidatePath('/workouts')
  return NextResponse.json({ id: data.id })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  // Verify ownership before deleting
  const { data: workout } = await db
    .from('workouts')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workout) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Delete in dependency order: sets → exercises → workout
  const { data: exercises } = await db.from('exercises').select('id').eq('workout_id', id)
  const exerciseIds = (exercises ?? []).map((e: { id: string }) => e.id)

  if (exerciseIds.length > 0) {
    await db.from('sets').delete().in('exercise_id', exerciseIds)
    await db.from('exercises').delete().eq('workout_id', id)
  }

  await db.from('workouts').delete().eq('id', id)

  revalidatePath('/workouts')
  return NextResponse.json({ ok: true })
}
