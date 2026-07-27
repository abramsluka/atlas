import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, AI_LIMIT_MESSAGE } from '@/lib/aiErrors'
import { toLocalDate } from '@/lib/date'
import { getUserTimezone } from '@/lib/getUserTimezone'

export const runtime = 'nodejs'
export const maxDuration = 30

const SUMMARY_SYSTEM = `You are a blunt, smart nutrition coach. Based on what the user has eaten today and their targets, give a 2-3 sentence honest read of their fuel state. Include what's going well, what to watch, and one concrete suggestion for the rest of the day. No filler. Under 60 words.`

const ASK_SYSTEM = `You are a direct, no-BS nutrition coach. The user is asking about their food today. Answer specifically using their actual numbers. Under 50 words.`

export async function GET(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const date = request.nextUrl.searchParams.get('date') ?? toLocalDate(await getUserTimezone(user.id))
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
  const date: string = body.date ?? toLocalDate(await getUserTimezone(user.id))
  const question: string | undefined = body.question ? String(body.question).trim() : undefined
  const chipLabel: string | null = body.chip_label ? String(body.chip_label) : null
  // Client's IANA timezone — without it the server formats taken_at in UTC,
  // which shifts evening meals into the early morning of the next day.
  const tz: string = typeof body.tz === 'string' && body.tz ? body.tz : 'UTC'

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
    .from('health_profile')
    .select('daily_calorie_target, daily_protein_target_g, daily_carbs_target_g')
    .eq('user_id', user.id)
    .maybeSingle()

  // Load today's training (gym_logs sets logged today)
  const dayStart = `${date}T00:00:00.000Z`
  const dayEnd = `${date}T23:59:59.999Z`
  const { data: gymLogRows } = await db
    .from('gym_logs')
    .select('logged_at, gym_exercises(name)')
    .eq('user_id', user.id)
    .gte('logged_at', dayStart)
    .lte('logged_at', dayEnd)

  // Build context string
  const lines: string[] = []

  if (mealList.length === 0) {
    lines.push('No meals logged today yet.')
  } else {
    lines.push(`Meals today (${date}):`)
    for (const m of mealList) {
      const time = m.taken_at
        ? new Date(m.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
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

  if (gymLogRows && gymLogRows.length > 0) {
    const logs = gymLogRows as unknown as Array<{ gym_exercises: { name: string } | null }>
    const names = [...new Set(logs.map(l => l.gym_exercises?.name ?? 'Unknown'))]
    lines.push(`Workout today: ${names.join(', ')} (${gymLogRows.length} sets)`)
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

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

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
        if (isAiLimitError(err)) {
          controller.enqueue(new TextEncoder().encode(AI_LIMIT_MESSAGE))
        } else {
          controller.error(err)
        }
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
