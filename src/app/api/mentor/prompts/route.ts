import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

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

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)
  const sevenDaysAgo = formatInTimeZone(subDays(new Date(), 7), TZ, 'yyyy-MM-dd')

  const [lastWorkoutRes, contextRes, jotsCountRes] = await Promise.all([
    db.from('workouts').select('completed_at, exercises(name)').eq('user_id', user.id).not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('mentor_context').select('primary_goal').eq('user_id', user.id).maybeSingle(),
    db.from('jots').select('id', { count: 'exact' }).eq('user_id', user.id).gte('created_at', sevenDaysAgo),
  ])

  const lastWorkout = lastWorkoutRes.data
  const primaryGoal = contextRes.data?.primary_goal ?? null
  const recentJotCount = jotsCountRes.count ?? 0

  // Days since last workout
  let daysSinceWorkout: number | null = null
  if (lastWorkout?.completed_at) {
    const lastDate = new Date(lastWorkout.completed_at)
    const todayDate = new Date(today)
    daysSinceWorkout = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000)
  }

  const snapshot = [
    lastWorkout ? `Last workout: ${new Date(lastWorkout.completed_at!).toDateString()} (${daysSinceWorkout} days ago), exercises: ${(lastWorkout.exercises as Array<{name: string}>).map(e => e.name).join(', ')}` : 'No recent workouts',
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
