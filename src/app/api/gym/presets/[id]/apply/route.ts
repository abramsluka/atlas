import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { GYM_PRESETS } from '@/data/gymPresets'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const preset = GYM_PRESETS.find(p => p.id === id)
  if (!preset) return NextResponse.json({ error: 'Preset not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const gymId: string = body.gymId ?? 'g_default'

  const db = createServiceClient()

  // Get existing exercises to check duplicates (case-insensitive)
  const { data: existing } = await db
    .from('gym_exercises')
    .select('name, order_index')
    .eq('user_id', user.id)

  const existingNames = new Set((existing ?? []).map((e: { name: string }) => e.name.toLowerCase()))
  const maxOrder = (existing ?? []).reduce((m: number, e: { order_index: number }) => Math.max(m, e.order_index), -1)

  const toInsert = preset.exercises
    .filter(ex => !existingNames.has(ex.name.toLowerCase()))

  const skipped = preset.exercises
    .filter(ex => existingNames.has(ex.name.toLowerCase()))
    .map(ex => ex.name)

  if (toInsert.length === 0) {
    return NextResponse.json({ added: [], skipped })
  }

  const rows = toInsert.map((ex, i) => ({
    user_id: user.id,
    name: ex.name,
    gym_id: gymId,
    day_ids: [],
    bodyweight: ex.bodyweight,
    start_weight: ex.start_weight,
    rep_min: ex.rep_min,
    rep_max: ex.rep_max,
    step: ex.step,
    order_index: maxOrder + 1 + i,
  }))

  const { data: added, error } = await db
    .from('gym_exercises')
    .insert(rows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ added: added ?? [], skipped })
}
