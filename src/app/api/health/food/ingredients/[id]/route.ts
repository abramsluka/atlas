import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Edit / delete a personal ingredient (custom food). Saved meals and food logs
// store denormalised ingredient snapshots, never FKs, so editing or deleting a
// custom food here can never corrupt an already-saved recipe or a past log.

const UpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  brand: z.string().max(80).nullable().optional(),
  cal_per_100: z.number().min(0).max(1000).optional(),
  protein_per_100: z.number().min(0).max(100).optional(),
  carbs_per_100: z.number().min(0).max(100).optional(),
  unit_name: z.string().max(24).nullable().optional(),
  unit_grams: z.number().positive().max(5000).nullable().optional(),
  liquid: z.boolean().optional(),
  hydrating: z.boolean().optional(),
  caffeine_per_100: z.number().min(0).max(500).nullable().optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const parsed = UpdateSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('user_ingredients')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .maybeSingle()

  if (error) {
    // unique (user_id, name) — a rename collided with another of their foods
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have a food with that name.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { error } = await db
    .from('user_ingredients')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
