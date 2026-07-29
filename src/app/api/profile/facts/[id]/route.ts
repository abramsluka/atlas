import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { content?: string; status?: string }
  const updates: Record<string, unknown> = {}

  if (typeof body.content === 'string') {
    const content = body.content.trim()
    if (!content) return NextResponse.json({ error: 'content cannot be empty' }, { status: 400 })
    updates.content = content
  }

  if (body.status !== undefined) {
    if (body.status !== 'active' && body.status !== 'pinned') {
      return NextResponse.json({ error: 'status must be active or pinned' }, { status: 400 })
    }
    updates.status = body.status
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('user_profile_facts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  // Never hard-delete — provenance is the point of this table.
  const { data, error } = await db
    .from('user_profile_facts')
    .update({ status: 'archived' })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new Response(null, { status: 204 })
}
