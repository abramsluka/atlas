import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIForUser } from '@/lib/openai'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'
import { PORTION_STYLE_RULES } from '@/features/food/portionStyle'
import type { WizardAnswer, EstimateResponse } from '@/features/food/types'

const MAX_QUESTIONS = 3

const SYSTEM_PROMPT = `You are a nutrition estimator inside a food-logging app. The user describes food or a drink in plain language. Your job is to produce an accurate calorie/macro estimate, and to sharpen it by asking sharp, food-specific follow-up questions first — the same way the photo flow does.

Respond with JSON only, in one of two shapes:

FINAL (you have enough info):
{"status":"final","item_name":string,"calories":int,"protein_g":number,"carbs_g":number,"confidence":"low"|"medium"|"high","notes":string,"portion_desc":string,"volume_oz":number|null,"is_hydrating":boolean,"caffeine_mg":number}

QUESTION (one detail is still needed):
{"status":"question","question":string,"reasoning":string,"options":[string,...],"calorie_delta":number}

Asking rules:
- DEFAULT TO ASKING. Almost every plain-language description leaves a high-impact detail open (how big, how it was cooked, how much sauce/oil, which restaurant). Ask ONE question about that detail before finalizing.
- Only skip straight to FINAL when the description ALREADY pins down both identity AND quantity with no calorie-moving ambiguity left — e.g. "12 oz orange juice", "two large eggs and one slice of toast", "grande oat latte". A bare food name ("chicken and rice", "a burrito", "pasta") is NOT enough — ask.
- Ask ONE question at a time, targeting the single highest-impact unknown for THIS specific food. On later questions move to the next distinct axis — never re-ask the same thing in different words.
- reasoning: one short phrase on why this detail matters for the estimate, e.g. "Portion size could swing this ±150 kcal" or "Whether it's pan-fried in oil changes the fat a lot". calorie_delta: your rough estimate of how many kcal the answer could move the total.
- options: 3-5 short, realistic tappable choices for THAT item. Examples: chicken breast → ["Half a palm","Palm-sized","Bigger than my palm","Two breasts"]; burrito → ["Homemade","Chipotle","Taco Bell","Other restaurant"]. Do NOT include an "Other" or "Not sure" option — the app adds "Something else" automatically.
${PORTION_STYLE_RULES}
- If the user typed exact units in their description or a free-text answer (grams, oz, cups), respect them — that's the one case units are fine.
- The conversation history of previous questions and answers is provided. Never re-ask an answered question.
- An answer marked [skipped] means the user declined: assume a sensible default (medium portion, common preparation) and move on.
- HARD LIMIT: if ${MAX_QUESTIONS} questions have already been asked (answered or skipped), you MUST return FINAL using reasonable defaults; set confidence to "low" if you had to guess.
- item_name: short (under 60 chars), title-style. portion_desc: human-readable relatable portion, e.g. "palm-sized grilled chicken breast" or "1 tall glass".
- is_hydrating: true for water, juice, milk, sports drinks, iced tea, soda; false for espresso shots, alcohol, milkshakes-as-dessert. volume_oz: fluid ounces, only when is_hydrating is true, else null.
- caffeine_mg: estimated caffeine in milligrams, scaled to the portion (drip coffee ~100 for 8oz, espresso shot ~60, latte/cappuccino ~75, cold brew ~150-200, black tea ~50, green tea ~30, cola ~35, energy drink ~200, decaf ~3). Use 0 for water, juice, milk, alcohol, and all food.
- notes: one short sentence on what drove the estimate.`

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const description = String(body.description ?? '').trim()
  const kind: 'food' | 'drink' = body.kind === 'drink' ? 'drink' : 'food'
  const answers: WizardAnswer[] = Array.isArray(body.answers) ? body.answers : []

  if (!description) return NextResponse.json({ error: 'Missing description' }, { status: 400 })

  const lines = [
    kind === 'drink'
      ? `The user is logging a DRINK: "${description}". Bias toward beverage interpretations.`
      : `The user is logging food: "${description}".`,
  ]
  if (answers.length > 0) {
    lines.push('', 'Follow-up questions so far:')
    for (const a of answers) {
      lines.push(`Q: ${a.question}`)
      lines.push(`A: ${a.skipped ? '[skipped]' : a.answer}`)
    }
    lines.push('', `Questions asked so far: ${answers.length} of ${MAX_QUESTIONS} max.`)
  }
  if (answers.length >= MAX_QUESTIONS) {
    lines.push('The question limit is reached — you MUST return FINAL now.')
  }

  try {
    const openai = await getOpenAIForUser(user.id)
    if (!openai) return noKeyResponse('openai')
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: lines.join('\n') },
      ],
      max_tokens: 300,
    })

    const raw = response.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)

    if (parsed.status === 'question' && answers.length < MAX_QUESTIONS) {
      const options = Array.isArray(parsed.options)
        ? parsed.options.map((o: unknown) => String(o)).slice(0, 5)
        : []
      if (!parsed.question || options.length < 2) {
        return NextResponse.json({ error: 'AI returned an invalid question' }, { status: 422 })
      }
      const result: EstimateResponse = {
        status: 'question',
        question: String(parsed.question),
        options,
        step: answers.length + 1,
        ...(parsed.reasoning ? { reasoning: String(parsed.reasoning).slice(0, 160) } : {}),
        ...(parsed.calorie_delta != null && Number.isFinite(Number(parsed.calorie_delta))
          ? { calorie_delta: Math.abs(Math.round(Number(parsed.calorie_delta))) }
          : {}),
      }
      return NextResponse.json(result)
    }

    // Treat anything else as final (including over-limit question attempts)
    if (!parsed.item_name || parsed.calories == null) {
      return NextResponse.json({ error: 'AI returned an invalid estimate' }, { status: 422 })
    }
    const isHydrating = Boolean(parsed.is_hydrating)
    const result: EstimateResponse = {
      status: 'final',
      item_name: String(parsed.item_name).slice(0, 80),
      calories: Math.round(Number(parsed.calories)),
      protein_g: Number(parsed.protein_g) || 0,
      carbs_g: Number(parsed.carbs_g) || 0,
      confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
      notes: String(parsed.notes ?? ''),
      portion_desc: String(parsed.portion_desc ?? '').slice(0, 120) || String(parsed.item_name).slice(0, 120),
      volume_oz: isHydrating && parsed.volume_oz != null ? Number(parsed.volume_oz) : null,
      is_hydrating: isHydrating,
      caffeine_mg: Math.max(0, Math.round(Number(parsed.caffeine_mg) || 0)),
    }
    return NextResponse.json(result)
  } catch (err) {
    if (isAiLimitError(err)) return aiLimitResponse()
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
