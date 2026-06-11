import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  const [jotsResult, countResult] = await Promise.all([
    db.from('jots').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(20),
    db.from('jots').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
  ])

  if (jotsResult.error) return NextResponse.json({ error: jotsResult.error.message }, { status: 500 })

  return NextResponse.json({ jots: jotsResult.data ?? [], total_count: countResult.count ?? 0 })
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { content } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  const db = createServiceClient()
  const { data, error } = await db
    .from('jots')
    .insert({ user_id: user.id, content: content.trim() })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
