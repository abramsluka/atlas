import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data } = await db
    .from('mentor_context')
    .select('primary_goal, about_me, goal_last_comment')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json(data ?? { primary_goal: null, about_me: null, goal_last_comment: null })
}
