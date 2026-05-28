import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const [configRes, exercisesRes, logsRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', user.id),
    db.from('po_logs').select('*').eq('user_id', user.id).order('logged_at', { ascending: true }),
  ])

  return NextResponse.json({
    config: configRes.data,
    exercises: exercisesRes.data ?? [],
    logs: logsRes.data ?? [],
  })
}
