import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isFactCategory, type ProfileFact, type ProfileFactWithSource } from '@/lib/profile/types'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await db
    .from('user_profile_facts')
    .select('id, category, tier, content, source_kind, source_id, status, first_seen_at, last_confirmed_at, expires_at')
    .eq('user_id', user.id)
    .in('status', ['active', 'pinned'])
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('last_confirmed_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const facts = (data ?? []) as ProfileFact[]

  // source_id has no FK (it points at journal_entries or mentor_conversations
  // depending on source_kind), so resolve the labels in two follow-up reads.
  const journalIds = facts.filter(f => f.source_kind === 'journal' && f.source_id).map(f => f.source_id!)
  const mentorIds = facts.filter(f => f.source_kind === 'mentor' && f.source_id).map(f => f.source_id!)

  const [journalRes, mentorRes] = await Promise.all([
    journalIds.length
      ? db.from('journal_entries').select('id, date, title').eq('user_id', user.id).in('id', journalIds)
      : Promise.resolve({ data: [] }),
    mentorIds.length
      ? db.from('mentor_conversations').select('id, created_at, title').eq('user_id', user.id).in('id', mentorIds)
      : Promise.resolve({ data: [] }),
  ])

  const journalById = new Map(
    (journalRes.data ?? []).map(e => [e.id as string, { date: e.date as string, title: (e.title as string | null) ?? null }]),
  )
  const mentorById = new Map(
    (mentorRes.data ?? []).map(c => [
      c.id as string,
      { date: (c.created_at as string).slice(0, 10), title: (c.title as string | null) ?? null },
    ]),
  )

  const withSource: ProfileFactWithSource[] = facts.map(f => {
    const source = f.source_kind === 'journal'
      ? journalById.get(f.source_id ?? '')
      : f.source_kind === 'mentor'
        ? mentorById.get(f.source_id ?? '')
        : undefined
    return { ...f, source_date: source?.date ?? null, source_title: source?.title ?? null }
  })

  return NextResponse.json({ facts: withSource })
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { category?: string; content?: string }
  const content = body.content?.trim()

  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
  if (!isFactCategory(body.category)) return NextResponse.json({ error: 'invalid category' }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('user_profile_facts')
    .insert({
      user_id: user.id,
      category: body.category,
      tier: 'durable',
      content,
      source_kind: 'manual',
      source_id: null,
      // Facts the user writes themselves are protected from consolidation.
      status: 'pinned',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
