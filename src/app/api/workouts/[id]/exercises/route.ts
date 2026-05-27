import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workoutId } = await params
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { orderIndex } = await request.json()

  console.log('[POST /api/workouts/[id]/exercises] insert payload:', {
    workoutId,
    orderIndex,
    userId: user.id,
  })

  const db = createServiceClient()

  const { data, error } = await db
    .from('exercises')
    .insert({ workout_id: workoutId, user_id: user.id, name: '', order_index: orderIndex })
    .select()
    .single()

  if (error) {
    console.error('[POST /api/workouts/[id]/exercises] supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
