import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { PlanItem } from '@/features/journal/types'

// Surgical single-item ops on a morning entry's plan. The orb's confirm cards
// hit this instead of PATCHing the whole array — the read-modify-write happens
// server-side in one request, so a stale client can't clobber the list.
const OpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('check'), item_id: z.string(), done: z.boolean().default(true) }),
  z.object({
    op: z.literal('add'),
    text: z.string().min(1).max(500),
    after_item_id: z.string().optional(),
    at_start: z.boolean().optional(),
  }),
  z.object({ op: z.literal('remove'), item_id: z.string() }),
])

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const parsed = OpSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: entry } = await db
    .from('journal_entries')
    .select('id, user_id, kind, plan')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (entry.kind !== 'morning') {
    return NextResponse.json({ error: 'Only morning entries have a plan' }, { status: 400 })
  }

  const plan: PlanItem[] = [...(entry.plan ?? [])]
  const op = parsed.data

  if (op.op === 'check') {
    const idx = plan.findIndex(p => p.id === op.item_id)
    if (idx === -1) return NextResponse.json({ error: 'Plan item not found' }, { status: 404 })
    plan[idx] = { ...plan[idx], done: op.done }
  } else if (op.op === 'add') {
    const item: PlanItem = { id: crypto.randomUUID(), text: op.text.trim(), done: false }
    const afterIdx = op.after_item_id ? plan.findIndex(p => p.id === op.after_item_id) : -1
    if (op.after_item_id && afterIdx === -1) {
      return NextResponse.json({ error: 'Anchor plan item not found' }, { status: 404 })
    }
    if (afterIdx !== -1) plan.splice(afterIdx + 1, 0, item)
    else if (op.at_start) plan.unshift(item)
    else plan.push(item)
  } else {
    const idx = plan.findIndex(p => p.id === op.item_id)
    if (idx === -1) return NextResponse.json({ error: 'Plan item not found' }, { status: 404 })
    plan.splice(idx, 1)
  }

  const { error } = await db
    .from('journal_entries')
    .update({ plan, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plan })
}
