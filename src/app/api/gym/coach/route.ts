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
  const setsToday = gymLogs.filter(l =>
    new Date(l.logged_at).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }) === today
  ).length

  // Body weight trend
  const bwFirst = bodyWeights[0]
  const bwLast = bodyWeights[bodyWeights.length - 1]
  const bwDelta = bwFirst && bwLast && bodyWeights.length >= 2
    ? bwLast.weight - bwFirst.weight
    : null

  // Build minimal context — just enough to know if they're on a roll or slacking
  const lines: string[] = []

  if (daysSinceLast === null) {
    lines.push('Has never logged a workout.')
  } else if (daysSinceLast === 0) {
    lines.push('Trained today.')
  } else if (daysSinceLast === 1) {
    lines.push('Last trained yesterday.')
  } else {
    lines.push(`Has not trained in ${daysSinceLast} days.`)
  }

  lines.push(`Workouts in the last 7 days: ${workoutsThisWeek}. The 7 days before that: ${workoutsLastWeek}.`)

  if (checkin?.morning_intent) {
    lines.push(`What they said they wanted today: "${checkin.morning_intent}".`)
  }

  const context = lines.join('\n')

  const devilSystem = `You are the voice of brutal self-accountability in this person's head. Your job is one thing: make them feel the cost of skipping the gym so viscerally they can't ignore it. Talk about what happens to their body, their confidence, their self-image when they stop showing up. Be raw, be uncomfortable, be real — not mean for the sake of it, but the kind of hard truth a person needs to hear at 4pm when they're deciding whether to go. 2–3 sentences. No data recitation, no "you only did X workouts" — pure consequence and identity. Make them feel it.`

  const angelSystem = `You are the voice of genuine belief in this person's head. Your job is to make them feel the pull of who they're becoming and why it's worth protecting. Talk about momentum, about what consistency does to a person over time, about the version of themselves they're building one session at a time. Be real, not hollow — this isn't "you've got this champ," it's the voice that actually knows what they're capable of. 2–3 sentences. No data recitation — pure fire and forward motion.`

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
