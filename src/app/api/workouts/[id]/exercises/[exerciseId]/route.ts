import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  const { id: workoutId, exerciseId } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  // Verify ownership
  const { data: workout } = await db
    .from('workouts')
    .select('id')
    .eq('id', workoutId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!workout) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.from('sets').delete().eq('exercise_id', exerciseId)
  await db.from('exercises').delete().eq('id', exerciseId).eq('workout_id', workoutId)

  return NextResponse.json({ ok: true })
}
