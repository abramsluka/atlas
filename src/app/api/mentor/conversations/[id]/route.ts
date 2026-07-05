import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Messages for one conversation (oldest first, ready to render).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: convo } = await db
    .from('mentor_conversations')
    .select('id, user_id, title')
    .eq('id', id)
    .maybeSingle()
  if (!convo || convo.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: messages, error } = await db
    .from('mentor_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: convo.id, title: convo.title, messages: messages ?? [] })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()
  const { data: convo } = await db.from('mentor_conversations').select('id, user_id').eq('id', id).maybeSingle()
  if (!convo || convo.user_id !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await db.from('mentor_conversations').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
