import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; exerciseId: string }> }
) {
  const { exerciseId } = await params
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { orderIndex } = await request.json()

  const db = createServiceClient()

  const { data, error } = await db
    .from('sets')
    .insert({
      exercise_id: exerciseId,
      user_id: user.id,
      order_index: orderIndex,
      completed: false,
    })
    .select()
    .single()

  if (error) {
    console.error('[POST sets] supabase error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
