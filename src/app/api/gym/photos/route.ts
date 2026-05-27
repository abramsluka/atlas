import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data: rows, error } = await db
    .from('progress_photos')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const photos = await Promise.all((rows ?? []).map(async (row) => {
    const { data: signed } = await db.storage
      .from('progress-photos')
      .createSignedUrl(row.storage_path, 3600)
    return { ...row, url: signed?.signedUrl ?? '' }
  }))

  return NextResponse.json(photos)
}

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  const date = (formData.get('date') as string | null) ?? new Date().toISOString().slice(0, 10)
  const weight = formData.get('weight') ? parseFloat(formData.get('weight') as string) : null
  const weight_unit = (formData.get('weight_unit') as string | null) ?? 'lbs'

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const ext = file.name.split('.').pop() ?? 'jpg'
  const storagePath = `${user.id}/${date}_${Date.now()}.${ext}`

  const db = createServiceClient()
  const { error: uploadError } = await db.storage
    .from('progress-photos')
    .upload(storagePath, file, { contentType: file.type, upsert: false })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: row, error: dbError } = await db
    .from('progress_photos')
    .insert({ user_id: user.id, date, weight, weight_unit, storage_path: storagePath })
    .select()
    .single()

  if (dbError) {
    await db.storage.from('progress-photos').remove([storagePath])
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  const { data: signed } = await db.storage
    .from('progress-photos')
    .createSignedUrl(storagePath, 3600)

  return NextResponse.json({ ...row, url: signed?.signedUrl ?? '' })
}
