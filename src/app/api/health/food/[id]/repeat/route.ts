import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { toLocalDate } from '@/lib/date'
import { getUserTimezone } from '@/lib/getUserTimezone'

// Duplicate an existing food log onto today. Photo meals get their own copy of
// the image so deleting either log never orphans the other's photo.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = createServiceClient()

  const { data: original } = await db
    .from('food_logs')
    .select('*')
    .eq('id', id)
    .single()

  if (!original || original.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date()
  const date = toLocalDate(await getUserTimezone(user.id))

  // Photo meals: copy the stored image to a fresh path so the two logs are independent.
  let storagePath: string | null = null
  if (original.storage_path) {
    const ext = original.storage_path.split('.').pop() ?? 'jpg'
    const newPath = `${user.id}/${date}_${now.getTime()}.${ext}`
    const { error: copyError } = await db.storage
      .from('food-photos')
      .copy(original.storage_path, newPath)
    if (copyError) {
      console.error('[food/repeat] photo copy failed:', copyError.message)
    } else {
      storagePath = newPath
    }
  }

  const { data: inserted, error: insertError } = await db
    .from('food_logs')
    .insert({
      user_id: user.id,
      date,
      storage_path: storagePath,
      item_name: original.item_name,
      calories: original.calories,
      protein_g: original.protein_g,
      carbs_g: original.carbs_g,
      fat_g: original.fat_g,
      confidence: original.confidence,
      ai_raw: original.ai_raw,
      notes: original.notes,
      source: original.source,
      barcode: original.barcode,
      volume_oz: original.volume_oz,
      emoji: original.emoji,
      search_text: original.search_text,
      user_description: original.user_description,
      // A repeat of an already-logged meal is settled — don't re-prompt refinement.
      refine_status: 'done',
      taken_at: now.toISOString(),
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Hydrating drinks logged water originally; mirror that on repeat (non-fatal).
  let waterLogged = false
  const volume_oz = original.volume_oz != null ? Number(original.volume_oz) : null
  if (original.source === 'drink' && volume_oz != null && volume_oz > 0) {
    const { error: waterError } = await db
      .from('water_logs')
      .insert({ user_id: user.id, date, amount_oz: volume_oz })
    if (waterError) console.error('[food/repeat] water insert failed:', waterError.message)
    else waterLogged = true
  }

  let photo_url: string | null = null
  if (storagePath) {
    const { data: signed } = await db.storage
      .from('food-photos')
      .createSignedUrl(storagePath, 3600)
    photo_url = signed?.signedUrl ?? null
  }

  return NextResponse.json({ ...inserted, photo_url, water_logged: waterLogged }, { status: 201 })
}
