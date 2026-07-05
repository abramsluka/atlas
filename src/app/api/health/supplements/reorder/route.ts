import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Bulk reorder: body { ids: string[] } — assigns order_index = array position to
// each supplement (scoped to the authed user). The client sends the full global
// order across all windows so order_index stays contiguous and each stack window
// keeps its internal order.
export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ids } = await req.json()
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
    return NextResponse.json({ error: 'ids must be a string array' }, { status: 400 })
  }

  const db = createServiceClient()
  const results = await Promise.all(
    ids.map((id: string, i: number) =>
      db.from('supplements').update({ order_index: i }).eq('id', id).eq('user_id', user.id)
    )
  )
  const failed = results.find(r => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
