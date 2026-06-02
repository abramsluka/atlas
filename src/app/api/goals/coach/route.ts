import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { differenceInDays, format } from 'date-fns'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate, daysAgoLocal } from '@/lib/date'
import type { Goal, HabitLog } from '@/features/goals/types'

function computeStreak(goalId: string, logs: HabitLog[], today: string): number {
  const dates = logs
    .filter(l => l.goal_id === goalId)
    .map(l => l.date)
    .sort()
    .reverse()

  let streak = 0
  let cursor = today
  for (const date of dates) {
    if (date === cursor) {
      streak++
      const d = new Date(cursor + 'T12:00:00')
      d.setDate(d.getDate() - 1)
      cursor = format(d, 'yyyy-MM-dd')
    } else if (date < cursor) {
      break
    }
  }
  return streak
}

function computeLongestStreak(goalId: string, logs: HabitLog[]): number {
  const dates = logs
    .filter(l => l.goal_id === goalId)
    .map(l => l.date)
    .sort()

  if (!dates.length) return 0

  let longest = 1
  let current = 1
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T12:00:00')
    const curr = new Date(dates[i] + 'T12:00:00')
    const diff = differenceInDays(curr, prev)
    if (diff === 1) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 1
    }
  }
  return longest
}

export async function POST(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const [goalsResult, logsResult] = await Promise.all([
    db
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
    db
      .from('habit_logs')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', daysAgoLocal(90, tz)),
  ])

  const goals: Goal[] = goalsResult.data ?? []
  const habitLogs: HabitLog[] = logsResult.data ?? []

  const activeGoals = goals.filter(g => !g.completed_at)
  const completedGoals = goals.filter(g => !!g.completed_at)

  if (activeGoals.length === 0 && completedGoals.length === 0) {
    return new Response("You don't have any goals yet. Add some and come back.", {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  // Days since first goal was created — measures how long they've been on this journey
  const firstGoalDate = goals[0]?.created_at
  const daysOnJourney = firstGoalDate
    ? differenceInDays(new Date(), new Date(firstGoalDate))
    : 0

  // Build the active goals summary
  const activeSummary = activeGoals.map(g => {
    if (g.type === 'habit') {
      const streak = computeStreak(g.id, habitLogs, today)
      const longest = computeLongestStreak(g.id, habitLogs)
      const loggedToday = habitLogs.some(l => l.goal_id === g.id && l.date === today)
      const atAllTimeHigh = streak > 0 && streak === longest
      return [
        `Habit: "${g.title}"`,
        `  Current streak: ${streak} days${atAllTimeHigh && streak > 2 ? ' (personal best)' : ''}`,
        `  Longest ever: ${longest} days`,
        `  Today: ${loggedToday ? '✓ done' : '✗ not done yet'}`,
      ].join('\n')
    }
    if (g.type === 'oneoff') {
      const daysUntilDue = g.due_date
        ? differenceInDays(new Date(g.due_date + 'T12:00:00'), new Date())
        : null
      return [
        `Goal: "${g.title}"`,
        g.description ? `  Description: ${g.description}` : null,
        g.due_date
          ? `  Due: ${g.due_date} (${daysUntilDue !== null && daysUntilDue >= 0 ? daysUntilDue + ' days away' : 'overdue'})`
          : null,
      ].filter(Boolean).join('\n')
    }
    if (g.type === 'numeric') {
      const current = g.current_value ?? 0
      const target = g.target_value
      const pct = target ? Math.round((current / target) * 100) : 0
      return [
        `Target: "${g.title}"`,
        `  Progress: ${current}${g.unit ? ' ' + g.unit : ''} of ${target ?? '?'}${g.unit ? ' ' + g.unit : ''} (${pct}%)`,
      ].join('\n')
    }
    return ''
  }).filter(Boolean).join('\n\n')

  const context = [
    daysOnJourney > 0 ? `Days working on goals: ${daysOnJourney}` : null,
    completedGoals.length > 0 ? `Goals already completed: ${completedGoals.length}` : null,
    `Active goals: ${activeGoals.length}`,
    '',
    activeSummary || 'No active goals.',
  ].filter(s => s !== null).join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 350,
    system: `You are Atlas, a personal AI life coach. You've been working alongside this person on their goals. You know their patterns and their potential better than they do.

Give them today's coaching in 3–4 sentences. Be direct and personal — reference specific habits, streaks, and numbers from their data. Speak like a coach who genuinely knows them, not a chatbot summarizing their stats.

The tone should be warm but honest: celebrate real wins specifically (a personal-best streak deserves a real acknowledgment), call out what's slipping without being harsh, and leave them feeling like they have a clear sense of what matters today. If they've been at this for a while, acknowledge the journey. If they just completed goals, mention it.

No bullet points, no headers, no hollow phrases like "great job" or "keep it up." Just speak to them directly, one human to another.`,
    messages: [
      {
        role: 'user',
        content: `Here's where I'm at with my goals:\n\n${context}`,
      },
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
