import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { rolledDate } from '@/features/food/date'

export const runtime = 'nodejs'
export const maxDuration = 30

const SUMMARY_SYSTEM = `You are a blunt, smart nutrition coach. Based on what the user has eaten today and their targets, give a 2-3 sentence honest read of their fuel state. Include what's going well, what to watch, and one concrete suggestion for the rest of the day. No filler. Under 60 words.`

const ASK_SYSTEM = `You are a direct, no-BS nutrition coach. The user is asking about their food today. Answer specifically using their actual numbers. Under 50 words.`

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const date = request.nextUrl.searchParams.get('date') ?? rolledDate(new Date())
  const db = createServiceClient()

  const { data: messages, error } = await db
    .from('food_coach_messages')
    .select('*')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(messages ?? [])
}

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const date: string = body.date ?? rolledDate(new Date())
  const question: string | undefined = body.question ? String(body.question).trim() : undefined
  const chipLabel: string | null = body.chip_label ? String(body.chip_label) : null

  const db = createServiceClient()

  // Load today's meals
  const { data: meals } = await db
    .from('food_logs')
    .select('item_name, calories, protein_g, carbs_g, fat_g, taken_at, coach_feedback')
    .eq('user_id', user.id)
    .eq('date', date)
    .order('taken_at', { ascending: true })

  const mealList = meals ?? []
  const totals = mealList.reduce(
    (acc, m) => ({
      cal: acc.cal + (m.calories ?? 0),
      pro: acc.pro + (Number(m.protein_g) || 0),
      carbs: acc.carbs + (Number(m.carbs_g) || 0),
    }),
    { cal: 0, pro: 0, carbs: 0 },
  )

  // Load health profile for targets
  const { data: profile } = await db
    .from('health_profiles')
    .select('daily_calorie_target, daily_protein_target_g, daily_carbs_target_g')
    .eq('user_id', user.id)
    .maybeSingle()

  // Load today's workout (completed today)
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`
  const { data: workouts } = await db
    .from('workouts')
    .select('id, name, completed_at')
    .eq('user_id', user.id)
    .not('completed_at', 'is', null)
    .gte('completed_at', dayStart)
    .lte('completed_at', dayEnd)

  // Build context string
  const lines: string[] = []

  if (mealList.length === 0) {
    lines.push('No meals logged today yet.')
  } else {
    lines.push(`Meals today (${date}):`)
    for (const m of mealList) {
      const time = m.taken_at
        ? new Date(m.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : ''
      lines.push(
        `  ${m.item_name} — ${m.calories} cal, ${Math.round(Number(m.protein_g))}g P, ${Math.round(Number(m.carbs_g))}g C${m.fat_g != null ? `, ${Math.round(Number(m.fat_g))}g F` : ''}${time ? ` (${time})` : ''}`,
      )
    }
    lines.push(
      `Total so far: ${totals.cal} cal, ${Math.round(totals.pro)}g protein, ${Math.round(totals.carbs)}g carbs`,
    )
  }

  if (profile?.daily_calorie_target) {
    lines.push(
      `Daily targets: ${profile.daily_calorie_target} cal, ${profile.daily_protein_target_g ?? '?'}g protein, ${profile.daily_carbs_target_g ?? '?'}g carbs`,
    )
    const calRem = profile.daily_calorie_target - totals.cal
    const proRem = (profile.daily_protein_target_g ?? 0) - totals.pro
    lines.push(
      `Remaining: ${calRem} cal, ${Math.round(proRem)}g protein`,
    )
  }

  if (workouts && workouts.length > 0) {
    lines.push(`Workout today: ${workouts.map(w => w.name ?? 'Unnamed session').join(', ')}`)
  }

  const context = lines.join('\n')
  const isSummary = !question

  // Save user message for ask-coach (not for summary)
  if (!isSummary && question) {
    await db.from('food_coach_messages').insert({
      user_id: user.id,
      date,
      role: 'user',
      content: question,
      chip_label: chipLabel,
      is_summary: false,
    })
  }

  // For summary: delete old summary first
  if (isSummary) {
    await db
      .from('food_coach_messages')
      .delete()
      .eq('user_id', user.id)
      .eq('date', date)
      .eq('is_summary', true)
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const userContent = isSummary
    ? context
    : `${context}\n\nUser question: ${question}`

  const stream = anthropic.messages.stream({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 150,
    system: isSummary ? SUMMARY_SYSTEM : ASK_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  })

  let accumulated = ''

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            const text = event.delta.text
            accumulated += text
            controller.enqueue(new TextEncoder().encode(text))
          }
        }
        await db.from('food_coach_messages').insert({
          user_id: user.id,
          date,
          role: 'assistant',
          content: accumulated,
          chip_label: null,
          is_summary: isSummary,
        })
      } catch (err) {
        console.error('[food/coach] stream error:', err)
        controller.error(err)
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
