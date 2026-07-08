import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CreateEntrySchema } from '@/features/journal/types'
import { generateTitle } from '@/lib/journalTitle'

export const maxDuration = 30

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('journal_entries')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = CreateEntrySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  // Untitled text entries get a short generated title (voice-only entries get one
  // after transcription). Morning plans skip title generation — the list falls
  // back to the first plan item.
  let title = parsed.data.title ?? null
  if (!title && parsed.data.kind !== 'morning' && parsed.data.body.trim()) {
    title = await generateTitle(parsed.data.body)
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('journal_entries')
    .insert({
      user_id: user.id,
      date: parsed.data.date,
      title,
      body: parsed.data.body,
      mood: parsed.data.mood ?? null,
      kind: parsed.data.kind,
      plan: parsed.data.plan,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
