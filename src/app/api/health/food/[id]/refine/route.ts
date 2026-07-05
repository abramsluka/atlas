import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { PORTION_STYLE_RULES } from '@/features/food/portionStyle'
import type { PhotoRefineQuestion, PhotoRefineAnswer } from '@/features/food/types'

const MAX_REFINE = 3

type AiRaw = {
  initial?: {
    item_name?: string
    calories?: number
    protein_g?: number
    carbs_g?: number
    fat_g?: number
    confidence?: string
    notes?: string
  }
  refine?: {
    questions: PhotoRefineQuestion[]
    answers: PhotoRefineAnswer[]
  }
}

const SYSTEM_PROMPT = `You are refining a food calorie estimate based on follow-up user answers about their meal photo.

You will be given the current estimate and the Q&A history. Your job is to either:
1. Ask one more clarifying question (if it would materially change the estimate by >50 kcal and you haven't hit the limit), OR
2. Return a final revised estimate incorporating all the answers.

Respond with JSON only, in one of two shapes:

QUESTION:
{"status":"question","question":string,"reasoning":string,"options":[string,...],"calorie_delta":number}

FINAL:
{"status":"final","calories":int,"protein_g":number,"carbs_g":number,"fat_g":number,"confidence":"low"|"medium"|"high","notes":string}

Rules:
- options: 3-5 short, realistic tappable choices.
${PORTION_STYLE_RULES}
- Never include "Other" as an option — the app adds it automatically.
- If the user typed an exact weight or volume in a free-text answer (grams, oz), respect it — that's the one case units are fine.
- An answer of "[skipped]" means user doesn't know — use a sensible default.
- FINAL should reflect all corrections from the answers. Adjust macros meaningfully.
- Only ask if it would shift the estimate by >50 kcal and there's a genuinely ambiguous detail left.`

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const answer = body.answer != null ? String(body.answer) : '[skipped]'
  const question = body.question ? String(body.question) : ''
  const rewindTo: number | undefined = body.rewindTo != null ? Number(body.rewindTo) : undefined

  const db = createServiceClient()

  const { data: logRow, error: fetchError } = await db
    .from('food_logs')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !logRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (logRow.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  // Allow rewind even if refine is 'done' — user is changing a previous answer
  if (logRow.refine_status !== 'open' && rewindTo == null) return NextResponse.json({ error: 'Refine not open' }, { status: 400 })
  if (!logRow.storage_path) return NextResponse.json({ error: 'No photo on this log' }, { status: 400 })

  const aiRaw = (logRow.ai_raw ?? {}) as AiRaw
  const initial = aiRaw.initial ?? {}
  const refineData = aiRaw.refine ?? { questions: [], answers: [] }

  // If rewinding, truncate stored answers to the rewind index
  const baseAnswers = rewindTo != null ? refineData.answers.slice(0, rewindTo) : refineData.answers
  const baseQuestions = rewindTo != null ? refineData.questions.slice(0, rewindTo + 1) : refineData.questions

  // Append the new answer
  const newAnswer: PhotoRefineAnswer = { question, answer }
  const updatedAnswers = [...baseAnswers, newAnswer]
  const totalAnswers = updatedAnswers.length

  // Download photo from storage
  const { data: fileData, error: downloadError } = await db.storage
    .from('food-photos')
    .download(logRow.storage_path)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to load photo' }, { status: 500 })
  }

  const arrayBuffer = await fileData.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  const mimeType = fileData.type || 'image/jpeg'
  const dataUrl = `data:${mimeType};base64,${base64}`

  // Build context
  const lines = [
    `Original estimate: ${initial.item_name ?? logRow.item_name}, ${initial.calories ?? logRow.calories} cal, ${initial.protein_g ?? logRow.protein_g}g P, ${initial.carbs_g ?? logRow.carbs_g}g C, ${initial.fat_g ?? logRow.fat_g ?? '?'}g F (confidence: ${initial.confidence ?? logRow.confidence})`,
    '',
    'Follow-up Q&A so far:',
    ...updatedAnswers.map(a => `Q: ${a.question}\nA: ${a.answer}`),
    '',
    `Questions answered: ${totalAnswers} of ${MAX_REFINE} max.`,
  ]

  if (totalAnswers >= MAX_REFINE) {
    lines.push('Question limit reached — you MUST return FINAL now.')
  }

  try {
    const openai = getOpenAI()
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: lines.join('\n') },
          ],
        },
      ],
      max_tokens: 300,
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)

    if (parsed.status === 'question' && totalAnswers < MAX_REFINE) {
      const options = Array.isArray(parsed.options)
        ? parsed.options.map((o: unknown) => String(o)).slice(0, 5)
        : []
      if (!parsed.question || options.length < 2) {
        return NextResponse.json({ error: 'AI returned invalid question' }, { status: 422 })
      }

      const nextQuestion: PhotoRefineQuestion = {
        question: String(parsed.question),
        reasoning: String(parsed.reasoning ?? ''),
        options,
        calorie_delta: parsed.calorie_delta != null ? Number(parsed.calorie_delta) : undefined,
      }

      const updatedAiRaw: AiRaw = {
        ...aiRaw,
        refine: {
          questions: [...baseQuestions, nextQuestion],
          answers: updatedAnswers,
        },
      }

      await db
        .from('food_logs')
        .update({ ai_raw: updatedAiRaw, updated_at: new Date().toISOString() })
        .eq('id', id)

      return NextResponse.json({ status: 'question', question: nextQuestion })
    }

    // Final — update the food log with revised macros
    if (parsed.calories == null) {
      return NextResponse.json({ error: 'AI returned invalid final' }, { status: 422 })
    }

    const updatedAiRaw: AiRaw = {
      ...aiRaw,
      refine: {
        questions: baseQuestions,
        answers: updatedAnswers,
      },
    }

    const updates = {
      calories: Math.round(Number(parsed.calories)),
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      fat_g: parsed.fat_g != null ? Number(parsed.fat_g) : logRow.fat_g,
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      notes: parsed.notes ? String(parsed.notes) : logRow.notes,
      refine_status: 'done' as const,
      ai_raw: updatedAiRaw,
      updated_at: new Date().toISOString(),
    }

    const { data: updated, error: updateError } = await db
      .from('food_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({
      status: 'final',
      id: updated.id,
      calories: updated.calories,
      protein_g: updated.protein_g,
      carbs_g: updated.carbs_g,
      fat_g: updated.fat_g,
      confidence: updated.confidence,
      notes: updated.notes,
      refine_status: 'done',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
