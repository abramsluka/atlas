export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { differenceInCalendarDays } from 'date-fns'
import type { TrainingProgram, ProgramSession, ActiveProgramResponse } from '@/features/gym/programTypes'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: prog } = await db
    .from('training_programs')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!prog) return NextResponse.json({ program: null })
  const program = prog as TrainingProgram

  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)

  let currentWeek = 1
  if (program.start_date) {
    const elapsed = differenceInCalendarDays(new Date(today + 'T12:00:00'), new Date(program.start_date + 'T12:00:00'))
    currentWeek = Math.min(Math.max(Math.floor(elapsed / 7) + 1, 1), program.duration_weeks)
  }

  const { data: sessRows } = await db
    .from('program_sessions')
    .select('*')
    .eq('program_id', program.id)
    .eq('week_number', currentWeek)
    .order('session_number', { ascending: true })

  const weekSessions = (sessRows as ProgramSession[] | null) ?? []

  const res: ActiveProgramResponse = { program, currentWeek, weekSessions }
  return NextResponse.json(res)
}
