import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: row, error: fetchError } = await db
    .from('progress_photos')
    .select('storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.storage.from('progress-photos').remove([row.storage_path])

  const { error } = await db
    .from('progress_photos')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
