import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import type { GeneratedProgram, ProgramExercise } from '@/features/gym/programTypes'
import type { GymExercise } from '@/features/gym/types'

// GET — list all programs (newest first)
export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('training_programs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST — persist a generated program. Archives any current active program,
// creates any new exercises the program introduced, then inserts sessions.
export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const program = (await req.json()) as GeneratedProgram
  if (!program?.sessions?.length) return NextResponse.json({ error: 'Empty program' }, { status: 400 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)

  // Existing exercises (for order_index + to know what's truly new)
  const { data: existing } = await db.from('gym_exercises').select('id, name, order_index').eq('user_id', user.id)
  const existingRows = (existing as Array<{ id: string; name: string; order_index: number }> | null) ?? []
  let nextOrder = existingRows.length ? Math.max(...existingRows.map(e => e.order_index)) + 1 : 0

  // Create new exercises once (dedupe by name), mapping name → new id.
  const newByName = new Map<string, string>()
  for (const session of program.sessions) {
    for (const ex of session.exercises) {
      if (!ex.is_new || ex.exercise_id) continue
      const key = ex.name.toLowerCase()
      if (newByName.has(key)) continue
      const dayIds = session.day_id ? [session.day_id] : []
      const insert: Omit<GymExercise, 'id' | 'user_id'> = {
        name: ex.name, gym_ids: [], day_ids: dayIds, bodyweight: false,
        start_weight: 0, rep_min: ex.rep_min, rep_max: ex.rep_max, step: 5, order_index: nextOrder++,
      }
      const { data: created } = await db.from('gym_exercises').insert({ ...insert, user_id: user.id }).select('id').single()
      if (created?.id) newByName.set(key, created.id as string)
    }
  }

  // Archive prior active program(s)
  await db.from('training_programs').update({ status: 'archived' }).eq('user_id', user.id).eq('status', 'active')

  // Insert the program
  const { data: prog, error: progErr } = await db.from('training_programs').insert({
    user_id: user.id,
    name: program.name,
    goal: program.goal,
    duration_weeks: program.duration_weeks,
    days_per_week: program.days_per_week,
    structure: program.structure,
    status: 'active',
    start_date: today,
    notes: program.notes,
  }).select().single()

  if (progErr || !prog) return NextResponse.json({ error: progErr?.message ?? 'Insert failed' }, { status: 500 })

  // Resolve new-exercise ids into the session exercise lists, then insert sessions.
  const sessionRows = program.sessions.map(s => ({
    program_id: prog.id,
    week_number: s.week_number,
    session_number: s.session_number,
    label: s.label,
    day_id: s.day_id,
    phase: s.phase,
    exercises: s.exercises.map((ex): ProgramExercise => ({
      ...ex,
      exercise_id: ex.exercise_id ?? newByName.get(ex.name.toLowerCase()) ?? null,
    })),
  }))

  const { error: sessErr } = await db.from('program_sessions').insert(sessionRows)
  if (sessErr) {
    // roll back the program so we don't leave a sessionless shell
    await db.from('training_programs').delete().eq('id', prog.id)
    return NextResponse.json({ error: sessErr.message }, { status: 500 })
  }

  return NextResponse.json(prog)
}
