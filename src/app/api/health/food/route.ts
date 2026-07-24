import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAIForUser } from '@/lib/openai'
import { noKeyResponse } from '@/lib/userKeys'
import { toLocalDate } from '@/lib/date'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { PORTION_STYLE_RULES } from '@/features/food/portionStyle'
import type { FoodEstimate, PhotoRefineQuestion } from '@/features/food/types'

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const dateParam = request.nextUrl.searchParams.get('date') ?? toLocalDate(await getUserTimezone(user.id))

  const { data: logs, error } = await db
    .from('food_logs')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', dateParam)
    .order('taken_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const withUrls = await Promise.all(
    (logs ?? []).map(async (log) => {
      if (!log.storage_path) return { ...log, photo_url: null }
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
  const photoEntries = formData.getAll('photo') as File[]
  const photos = photoEntries.filter(f => f instanceof File && f.size > 0).slice(0, 3)
  if (photos.length === 0) return NextResponse.json({ error: 'No photo provided' }, { status: 400 })
  const description = (formData.get('description') as string | null)?.trim() ?? ''
  // Client sends its local rolled date so we store under the user's actual day, not the server's UTC day
  const clientDate = (formData.get('date') as string | null) ?? null

  const photoData = await Promise.all(
    photos.map(async (photo) => {
      const bytes = await photo.arrayBuffer()
      const base64 = Buffer.from(bytes).toString('base64')
      const mimeType = photo.type || 'image/jpeg'
      return { bytes, base64, mimeType, dataUrl: `data:${mimeType};base64,${base64}` }
    })
  )

  const openai = await getOpenAIForUser(user.id)
  if (!openai) return noKeyResponse('openai')
  let estimate: FoodEstimate

  try {
    const imageMessages = photoData.map(p => ({
      type: 'image_url' as const,
      image_url: { url: p.dataUrl },
    }))
    const textPrompt = description
      ? `The user says: "${description}". These ${photos.length > 1 ? photos.length + ' photos show the same meal from different angles' : 'photo shows a meal'}. Use the description to confirm food identity and portion size. Estimate total calories, protein, and carbs for the full meal. Return JSON with: item_name, calories, protein_g, carbs_g, confidence, notes.`
      : `These ${photos.length > 1 ? photos.length + ' photos show the same meal from different angles — use all of them together' : 'photo shows a meal'}. Estimate total calories, protein, and carbs. Return JSON with: item_name, calories, protein_g, carbs_g, confidence, notes.`

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a food calorie estimator. Look at the photo(s) and return your best estimate for the food shown. Multiple photos may show the same meal from different angles — combine them for a better estimate.

Be honest about confidence — "high" for clearly visible single items with unambiguous portions, "medium" for typical restaurant meals, "low" for ambiguous or partially visible food.

Return JSON only, no prose. Required fields:
- item_name (string, max 80 chars)
- calories (integer)
- protein_g (number)
- carbs_g (number)
- fat_g (number)
- confidence ("low"|"medium"|"high")
- notes (string, one sentence on what drove the estimate)
- refine_question (object or null):
  - question (string): one follow-up question to sharpen accuracy
  - reasoning (string): why this matters, e.g. "Portion size could shift this by ±80 kcal"
  - options (array of 3-5 short, realistic tappable choices for this specific food)
  - calorie_delta (number): rough kcal range the answer could change

${PORTION_STYLE_RULES}
- Do NOT include an "Other" option — the app adds one automatically.

Set refine_question to null only when confidence is already "high" and the portion is completely unambiguous. Otherwise always provide one.`,
        },
        {
          role: 'user',
          content: [
            ...imageMessages,
            { type: 'text' as const, text: textPrompt },
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

    const confidence: 'low' | 'medium' | 'high' = ['low', 'medium', 'high'].includes(parsed.confidence)
      ? parsed.confidence
      : 'medium'

    let refineQuestion: PhotoRefineQuestion | null = null
    if (parsed.refine_question && typeof parsed.refine_question === 'object') {
      const rq = parsed.refine_question
      const options = Array.isArray(rq.options)
        ? rq.options.map((o: unknown) => String(o)).slice(0, 5)
        : []
      if (rq.question && options.length >= 2) {
        refineQuestion = {
          question: String(rq.question),
          reasoning: String(rq.reasoning ?? ''),
          options,
          calorie_delta: rq.calorie_delta != null ? Number(rq.calorie_delta) : undefined,
        }
      }
    }

    estimate = {
      item_name: String(parsed.item_name).slice(0, 80),
      calories: Math.round(Number(parsed.calories)),
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      fat_g: parsed.fat_g != null ? Number(parsed.fat_g) : null,
      confidence,
      notes: String(parsed.notes ?? ''),
    }

    const now = new Date()
    const date = clientDate ?? toLocalDate(await getUserTimezone(user.id))
    const primaryPhoto = photoData[0]
    const ext = primaryPhoto.mimeType.split('/')[1] ?? 'jpg'
    const storagePath = `${user.id}/${date}_${now.getTime()}.${ext}`

    const { error: uploadError } = await db.storage
      .from('food-photos')
      .upload(storagePath, Buffer.from(primaryPhoto.bytes), { contentType: primaryPhoto.mimeType })

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const aiRaw = {
      initial: parsed,
      refine: {
        questions: refineQuestion ? [refineQuestion] : [],
        answers: [],
      },
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
        fat_g: estimate.fat_g,
        confidence: estimate.confidence,
        ai_raw: aiRaw,
        notes: estimate.notes || null,
        refine_status: refineQuestion ? 'open' : 'done',
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
