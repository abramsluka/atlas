import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Slim library index for client-side autocomplete filtering.
export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('exercise_library')
    .select('id, name, short_name, aliases, primary_muscles, bodyweight, default_goal, rep_min, rep_max, step, popularity, start_weight_ratio, female_factor')
    .order('popularity', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
