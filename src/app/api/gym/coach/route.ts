import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { differenceInDays, subDays, format } from 'date-fns'

export async function POST(request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()
  const mode: 'devil' | 'angel' = body.mode === 'angel' ? 'angel' : 'devil'

  const db = createServiceClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const sevenDaysAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const fourteenDaysAgo = format(subDays(new Date(), 14), 'yyyy-MM-dd')

  const [workoutsResult, checkinResult, bodyWeightResult, gymLogsResult] = await Promise.all([
    db
      .from('workouts')
      .select('id, name, completed_at, created_at')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(20),
    db
      .from('daily_checkins')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),
    db
      .from('body_weight_logs')
      .select('weight, date_key')
      .eq('user_id', user.id)
      .gte('date_key', fourteenDaysAgo)
      .order('date_key', { ascending: true }),
    db
      .from('po_logs')
      .select('weight, reps, logged_at, exercise_id')
      .eq('user_id', user.id)
      .gte('logged_at', sevenDaysAgo)
      .order('logged_at', { ascending: false }),
  ])

  const workouts = workoutsResult.data ?? []
  const checkin = checkinResult.data
  const bodyWeights = bodyWeightResult.data ?? []
  const gymLogs = gymLogsResult.data ?? []

  // Days since last completed workout
  const lastWorkout = workouts[0]
  const daysSinceLast = lastWorkout?.completed_at
    ? differenceInDays(new Date(), new Date(lastWorkout.completed_at))
    : null

  // Workouts this week vs last week
  const thisWeekCutoff = subDays(new Date(), 7)
  const lastWeekCutoff = subDays(new Date(), 14)
  const workoutsThisWeek = workouts.filter(
    w => w.completed_at && new Date(w.completed_at) > thisWeekCutoff
  ).length
  const workoutsLastWeek = workouts.filter(
    w => w.completed_at && new Date(w.completed_at) > lastWeekCutoff
      && new Date(w.completed_at) <= thisWeekCutoff
  ).length

  // Sets logged today (from gym PO logger)
  const setsToday = gymLogs.filter(l => l.logged_at.slice(0, 10) === today).length

  // Body weight trend
  const bwFirst = bodyWeights[0]
  const bwLast = bodyWeights[bodyWeights.length - 1]
  const bwDelta = bwFirst && bwLast && bodyWeights.length >= 2
    ? bwLast.weight - bwFirst.weight
    : null

  // Build context
  const lines: string[] = []

  if (daysSinceLast === null) {
    lines.push('No workouts logged yet.')
  } else if (daysSinceLast === 0) {
    lines.push(`Trained today (${setsToday > 0 ? setsToday + ' sets logged' : 'no sets logged yet'}).`)
  } else {
    lines.push(`Last trained ${daysSinceLast} day${daysSinceLast === 1 ? '' : 's'} ago.`)
  }

  lines.push(`Workouts this week: ${workoutsThisWeek}. Last week: ${workoutsLastWeek}.`)

  if (setsToday > 0) lines.push(`Sets logged so far today: ${setsToday}.`)

  if (checkin?.morning_planned_training !== null && checkin?.morning_planned_training !== undefined) {
    lines.push(`Today's morning check-in: ${checkin.morning_planned_training ? 'planned to train' : 'planned rest day'}.`)
  }
  if (checkin?.morning_intent) {
    lines.push(`Training intent: "${checkin.morning_intent}".`)
  }
  if (checkin?.evening_actual_training !== null && checkin?.evening_actual_training !== undefined) {
    lines.push(`Evening check-in: ${checkin.evening_actual_training ? 'actually trained' : 'did not train'}.`)
  }

  if (bwDelta !== null) {
    const dir = bwDelta > 0 ? 'up' : bwDelta < 0 ? 'down' : 'unchanged'
    lines.push(`Body weight over last ${bodyWeights.length} days: ${dir} ${Math.abs(bwDelta).toFixed(1)} lbs.`)
  }

  const context = lines.join('\n')

  const devilSystem = `You are the devil on this person's shoulder — the voice of their darkest self-doubt and their most brutal internal critic. You see every skip, every excuse, every way they're letting themselves down. Your job is to make them uncomfortable enough to get off their ass and train. Be harsh, specific, visceral. Say the things they're afraid to admit to themselves. Focus on the consequences of NOT doing the work — what they become, what they lose, how they look, how they feel. Keep it to 2–3 sentences. No softening, no silver lining, no "but you can do it." Pure accountability.`

  const angelSystem = `You are the angel on this person's shoulder — not a cheerleader, but a genuine believer who sees exactly what they're building. You see the real progress even when they can't. Your job is to make them feel the pull of who they're becoming, not just the grind they're doing. Be specific to their actual numbers and patterns. Make the momentum feel real and worth protecting. Keep it to 2–3 sentences. No hollow hype, no generic motivation — speak to what the data actually shows.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: mode === 'devil' ? devilSystem : angelSystem,
    messages: [
      { role: 'user', content: `My training data:\n\n${context}` },
    ],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
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
