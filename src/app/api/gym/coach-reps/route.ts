import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()

  const [configRes, exercisesRes, logsRes, profileRes, bodyweightRes] = await Promise.all([
    db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
    db.from('gym_exercises').select('*').eq('user_id', user.id),
    db.from('po_logs').select('*').eq('user_id', user.id)
      .gte('logged_at', thirtyDaysAgo)
      .order('logged_at', { ascending: false }),
    db.from('health_profile').select('age, sex, weight_goal').eq('user_id', user.id).maybeSingle(),
    db.from('body_weight_logs').select('weight_lbs, logged_at').eq('user_id', user.id)
      .order('logged_at', { ascending: false }).limit(14),
  ])

  const config = configRes.data
  const exercises = exercisesRes.data ?? []
  const logs = logsRes.data ?? []
  const profile = profileRes.data
  const bodyweights = bodyweightRes.data ?? []

  // Compute avg reps in last 30 days
  const avgReps = logs.length
    ? (logs.reduce((s: number, l: { reps: number }) => s + l.reps, 0) / logs.length).toFixed(1)
    : null

  // How often the current upgrade_at_reps ceiling was hit in last 30 days
  const currentCeiling = config?.upgrade_at_reps ?? 12
  const ceilingHits = logs.filter((l: { reps: number }) => l.reps >= currentCeiling).length

  // Rep range across exercises
  const repMins = exercises.map((e: { rep_min: number }) => e.rep_min)
  const repMaxs = exercises.map((e: { rep_max: number }) => e.rep_max)
  const repRangeStr = exercises.length
    ? `${Math.min(...repMins)}–${Math.max(...repMaxs)}`
    : 'unknown'

  // Body weight trend
  const bwLatest = bodyweights[0]?.weight_lbs
  const bwOldest = bodyweights[bodyweights.length - 1]?.weight_lbs
  const bwTrend = bwLatest && bwOldest && bodyweights.length >= 3
    ? (bwLatest - bwOldest > 0 ? 'up' : bwLatest - bwOldest < 0 ? 'down' : 'stable')
    : null

  const contextLines = [
    profile?.age ? `Age: ${profile.age}` : null,
    profile?.sex ? `Sex: ${profile.sex === 'm' ? 'male' : profile.sex === 'f' ? 'female' : 'other'}` : null,
    profile?.weight_goal ? `Weight goal: ${profile.weight_goal}` : null,
    bwLatest ? `Current body weight: ${bwLatest} lbs${bwTrend ? ` (trending ${bwTrend} over last ${bodyweights.length} entries)` : ''}` : null,
    `Exercises tracked: ${exercises.length}`,
    avgReps ? `Average reps logged in last 30 days: ${avgReps}` : 'No recent logs.',
    `Current upgrade_at_reps setting: ${currentCeiling}`,
    `Times ceiling hit in last 30 days: ${ceilingHits} (out of ${logs.length} sets)`,
    `Rep ranges configured across exercises: ${repRangeStr}`,
  ].filter(Boolean).join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      system: `You are an expert strength and conditioning coach. Given a user's training data, recommend a single "upgrade_at_reps" number — the rep ceiling at which they should increase weight. This number should be set so that progressions happen roughly every 2–4 weeks for most exercises, balancing hypertrophy (8–15 rep range) and progressive overload. Return ONLY valid JSON with no markdown: { "reps": number, "reason": string }. The reason must be 1 concise sentence, specific to their data.`,
      messages: [{
        role: 'user',
        content: `Here is my training data:\n\n${contextLines}\n\nWhat should my upgrade_at_reps be?`,
      }],
    })

    const text = (message.content[0] as { type: string; text: string }).text.trim()
    const parsed = JSON.parse(text)
    return NextResponse.json({ reps: parsed.reps, reason: parsed.reason })
  } catch {
    return NextResponse.json({ reps: 12, reason: 'Default recommendation — not enough data yet.' })
  }
}
