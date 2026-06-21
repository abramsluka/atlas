import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { TrainingProgram, ProgramSession, ProgramDetailResponse } from '@/features/gym/programTypes'

// GET — full program detail (program + every session)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: prog } = await db
    .from('training_programs')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!prog) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: sessRows } = await db
    .from('program_sessions')
    .select('*')
    .eq('program_id', id)
    .order('week_number', { ascending: true })
    .order('session_number', { ascending: true })

  const res: ProgramDetailResponse = { program: prog as TrainingProgram, sessions: (sessRows as ProgramSession[] | null) ?? [] }
  return NextResponse.json(res)
}

// PATCH — rename, change status (archive/complete/reactivate), or adjust start_date
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (typeof body.name === 'string') updates.name = body.name
  if (['active', 'completed', 'archived'].includes(body.status)) updates.status = body.status
  if (typeof body.start_date === 'string' || body.start_date === null) updates.start_date = body.start_date
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const db = createServiceClient()
  // Re-activating one program archives the others.
  if (updates.status === 'active') {
    await db.from('training_programs').update({ status: 'archived' }).eq('user_id', user.id).eq('status', 'active').neq('id', id)
  }

  const { data, error } = await db
    .from('training_programs')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE — hard delete (sessions cascade)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { error } = await db.from('training_programs').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
