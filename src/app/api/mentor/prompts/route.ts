import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getAnthropicForUser } from '@/lib/anthropic'
import { noKeyResponse } from '@/lib/userKeys'

const FALLBACK_PROMPTS = [
  'How is my week looking?',
  'What should I focus on today?',
  'How is my recovery trending?',
  'Am I making progress on my goal?',
]

// Simple in-memory cache per user (process-lifetime)
const cache = new Map<string, { ts: number; prompts: string[] }>()
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cached = cache.get(user.id)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ prompts: cached.prompts })
  }

  const anthropic = await getAnthropicForUser(user.id)
  if (!anthropic) return noKeyResponse('anthropic')

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)
  const sevenDaysAgo = formatInTimeZone(subDays(new Date(), 7), TZ, 'yyyy-MM-dd')

  const [gymLogsRes, contextRes, jotsCountRes] = await Promise.all([
    // Recent sets, newest first — the latest day's logs describe the last workout
    db.from('gym_logs').select('logged_at, gym_exercises(name)').eq('user_id', user.id).order('logged_at', { ascending: false }).limit(20),
    db.from('mentor_context').select('primary_goal').eq('user_id', user.id).maybeSingle(),
    db.from('jots').select('id', { count: 'exact' }).eq('user_id', user.id).gte('created_at', sevenDaysAgo),
  ])

  const gymLogs = (gymLogsRes.data ?? []) as unknown as Array<{ logged_at: string; gym_exercises: { name: string } | null }>
  const primaryGoal = contextRes.data?.primary_goal ?? null
  const recentJotCount = jotsCountRes.count ?? 0

  // Days since last workout + that session's exercises
  let daysSinceWorkout: number | null = null
  let lastWorkoutLine = 'No recent workouts'
  if (gymLogs.length > 0) {
    const lastDate = new Date(gymLogs[0].logged_at)
    daysSinceWorkout = Math.floor((new Date(today).getTime() - lastDate.getTime()) / 86400000)
    const sameDay = gymLogs.filter(l => new Date(l.logged_at).toDateString() === lastDate.toDateString())
    const names = [...new Set(sameDay.map(l => l.gym_exercises?.name ?? 'Unknown'))]
    lastWorkoutLine = `Last workout: ${lastDate.toDateString()} (${daysSinceWorkout} days ago), exercises: ${names.join(', ')}`
  }

  const snapshot = [
    lastWorkoutLine,
    `Days since last workout: ${daysSinceWorkout ?? 'unknown'}`,
    `Primary goal: ${primaryGoal ?? 'not set'}`,
    `Jots captured in last 7 days: ${recentJotCount}`,
    `Today: ${today}`,
  ].join('\n')

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Generate exactly 4 short, specific suggested questions Luka could ask his AI mentor right now, based on his current data. Make them feel personally relevant to what's actually going on with him, not generic. Return ONLY a JSON array of 4 strings, no other text.

DATA:
${snapshot}

Goal: ${primaryGoal ?? 'not set'}

Rules:
- Each prompt is 4-8 words
- At least 2 should reference specific data points
- Vary the topics (don't make all 4 about the same thing)
- Sound natural, like something a person would actually ask`,
      }],
    })

    const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    const match = text.match(/\[[\s\S]*\]/)
    if (match) {
      const prompts = JSON.parse(match[0]) as string[]
      if (Array.isArray(prompts) && prompts.length === 4) {
        cache.set(user.id, { ts: Date.now(), prompts })
        return NextResponse.json({ prompts })
      }
    }
  } catch (e) {
    console.error('prompts generation failed', e)
  }

  return NextResponse.json({ prompts: FALLBACK_PROMPTS })
}
