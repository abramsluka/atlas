export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Edit a habit. Body may include any of { name, emoji, perWeek } — only the
// provided fields change. (The inline goal stepper sends perWeek alone; the
// edit sheet sends name/emoji/perWeek together.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const update: Record<string, unknown> = {}

    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 })
      update.name = name
    }
    if (body?.emoji !== undefined) {
      const emoji = typeof body.emoji === 'string' ? body.emoji.trim() : ''
      update.emoji = emoji || '✅'
    }
    if (body?.perWeek !== undefined) {
      const perWeek = Number(body.perWeek)
      if (!Number.isInteger(perWeek) || perWeek < 1 || perWeek > 7) {
        return NextResponse.json({ error: 'perWeek must be an integer 1..7' }, { status: 400 })
      }
      update.cadence = { per_week: perWeek }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    const db = createServiceClient()
    const { data, error } = await db
      .from('habits')
      .update(update)
      .eq('id', id).eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[habits/patch] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// Remove a habit — soft archive (active=false) so completion history is
// preserved and compute.ts stops surfacing it. Scoped to the authed user.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const authClient = await createClient()
    const { data: { user } } = await authClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const db = createServiceClient()
    const { data, error } = await db
      .from('habits')
      .update({ active: false, archived_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[habits/delete] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
