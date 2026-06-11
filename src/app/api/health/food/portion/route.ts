import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'

// Estimate grams of a known product shown in a photo. Photo is NOT stored.
export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const photo = formData.get('photo') as File | null
  const productName = String(formData.get('product_name') ?? '').slice(0, 120)
  const per100g = String(formData.get('per_100g') ?? '').slice(0, 200)

  if (!photo || photo.size === 0) return NextResponse.json({ error: 'No photo' }, { status: 400 })
  if (!productName) return NextResponse.json({ error: 'Missing product_name' }, { status: 400 })

  const bytes = await photo.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const dataUrl = `data:${photo.type || 'image/jpeg'};base64,${base64}`

  try {
    const openai = getOpenAI()
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You estimate the weight in grams of a known packaged food product shown in a photo. The product identity and per-100g nutrition are already known — your ONLY job is portion size. Use visual cues: plate/bowl/hand size, package fill level, typical serving shapes. Return JSON only: { "grams": integer, "reasoning": string (one short sentence) }. If you genuinely cannot see the food, return { "grams": null, "reasoning": "..." }.',
        },
        {
          role: 'user',
          content: [
            { type: 'image_url' as const, image_url: { url: dataUrl } },
            {
              type: 'text' as const,
              text: `This is ${productName}${per100g ? ` (${per100g} per 100g)` : ''}. How many grams are shown in this photo?`,
            },
          ],
        },
      ],
      max_tokens: 150,
    })

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? '{}')
    const grams = Number(parsed.grams)
    if (!Number.isFinite(grams) || grams <= 0) {
      return NextResponse.json({ error: parsed.reasoning || 'Could not estimate portion from photo' }, { status: 422 })
    }
    return NextResponse.json({ grams: Math.round(grams), reasoning: String(parsed.reasoning ?? '') })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
