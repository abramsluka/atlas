import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CreateGoalSchema } from '@/features/goals/types'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { daysAgoLocal } from '@/lib/date'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)

  const [goalsResult, logsResult] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .order('order_index', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('habit_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', daysAgoLocal(30, tz)),
  ])

  if (goalsResult.error) return NextResponse.json({ error: goalsResult.error.message }, { status: 500 })
  if (logsResult.error) return NextResponse.json({ error: logsResult.error.message }, { status: 500 })

  return NextResponse.json({ goals: goalsResult.data ?? [], habitLogs: logsResult.data ?? [] })
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = CreateGoalSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const db = createServiceClient()

  // For numeric goals, capture the starting value so descending goals can
  // compute progress relative to where the user began.
  const isNumeric = parsed.data.type === 'numeric'
  const currentValue = isNumeric ? (parsed.data.current_value ?? 0) : 0
  const direction = isNumeric ? (parsed.data.direction ?? 'ascending') : 'ascending'

  const { data, error } = await db
    .from('goals')
    .insert({
      user_id: user.id,
      type: parsed.data.type,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      target_value: parsed.data.target_value ?? null,
      current_value: isNumeric ? currentValue : 0,
      start_value: isNumeric ? currentValue : null,
      direction,
      unit: parsed.data.unit ?? null,
      due_date: parsed.data.due_date ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
