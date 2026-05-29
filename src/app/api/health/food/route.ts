import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { format, subHours } from 'date-fns'
import type { FoodEstimate } from '@/features/food/types'

function rolledDate(now: Date): string {
  const adjusted = now.getHours() < 6 ? subHours(now, 6) : now
  return format(adjusted, 'yyyy-MM-dd')
}

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const dateParam = request.nextUrl.searchParams.get('date') ?? rolledDate(new Date())

  const { data: logs, error } = await db
    .from('food_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', dateParam)
    .order('taken_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const withUrls = await Promise.all(
    (logs ?? []).map(async (log) => {
      const { data } = await db.storage
        .from('food-photos')
        .createSignedUrl(log.storage_path, 3600)
      return { ...log, photo_url: data?.signedUrl ?? null }
    }),
  )

  return NextResponse.json(withUrls)
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  const formData = await request.formData()
  const photo = formData.get('photo') as File | null
  if (!photo) return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
  const description = (formData.get('description') as string | null)?.trim() ?? ''

  const bytes = await photo.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mimeType = photo.type || 'image/jpeg'
  const dataUrl = `data:${mimeType};base64,${base64}`

  const openai = getOpenAI()
  let estimate: FoodEstimate

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are a food calorie estimator. Look at the photo and return your best estimate of calories, protein in grams, and carbs in grams for the food shown. Be honest about confidence — "high" for clearly visible single items with known portions, "medium" for typical restaurant meals, "low" for ambiguous or partially visible food. Keep item_name short (under 80 chars). Return JSON only, no prose. Required fields: item_name, calories (integer), protein_g (number), carbs_g (number), confidence ("low"|"medium"|"high"), notes (string).',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            {
              type: 'text',
              text: description
                ? `The user says: "${description}". Trust this description — use it to confirm the food identity and portion size. Estimate the calories, protein, and carbs. Return JSON with: item_name, calories, protein_g, carbs_g, confidence, notes.`
                : 'Estimate the calories, protein, and carbs in this meal. Return JSON with: item_name, calories, protein_g, carbs_g, confidence, notes.',
            },
          ],
        },
      ],
      max_tokens: 300,
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)

    if (!parsed.item_name || parsed.calories == null) {
      return NextResponse.json({ error: 'AI returned invalid estimate' }, { status: 422 })
    }

    estimate = {
      item_name: String(parsed.item_name).slice(0, 80),
      calories: Math.round(Number(parsed.calories)),
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence)
        ? parsed.confidence
        : 'medium',
      notes: String(parsed.notes ?? ''),
    }

    const now = new Date()
    const date = rolledDate(now)
    const ext = mimeType.split('/')[1] ?? 'jpg'
    const storagePath = `${user.id}/${date}_${now.getTime()}.${ext}`

    const { error: uploadError } = await db.storage
      .from('food-photos')
      .upload(storagePath, Buffer.from(bytes), { contentType: mimeType })

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { data: inserted, error: insertError } = await db
      .from('food_logs')
      .insert({
        user_id: user.id,
        date,
        storage_path: storagePath,
        item_name: estimate.item_name,
        calories: estimate.calories,
        protein_g: estimate.protein_g,
        carbs_g: estimate.carbs_g,
        confidence: estimate.confidence,
        ai_raw: JSON.parse(raw),
        notes: estimate.notes || null,
        taken_at: now.toISOString(),
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const { data: signedData } = await db.storage
      .from('food-photos')
      .createSignedUrl(storagePath, 3600)

    return NextResponse.json({ ...inserted, photo_url: signedData?.signedUrl ?? null }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
