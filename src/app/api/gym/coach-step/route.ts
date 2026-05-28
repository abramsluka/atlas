import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { exerciseName, isBodyweight, units } = await req.json()

  if (isBodyweight) {
    return NextResponse.json({ step: 1, reason: 'Bodyweight exercises progress by reps, not weight.' })
  }

  const db = createServiceClient()
  const exercise = await db
    .from('gym_exercises')
    .select('id, step')
    .eq('user_id', user.id)
    .ilike('name', exerciseName)
    .maybeSingle()

  const existingStep = exercise.data?.step ?? null

  const contextLines = [
    `Exercise name: ${exerciseName}`,
    `Weight unit: ${units}`,
    existingStep ? `Current step setting: ${existingStep} ${units}` : 'No existing step configured.',
  ].join('\n')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: `You are an expert strength coach. Given an exercise name and weight unit, recommend a weight increment step size — the amount to add when the user is ready to progress. Use these guidelines: compound barbell lifts (squat, deadlift, bench, row, OHP) = 5 lbs or 2.5 kg. Smaller compounds and cable machines = 2.5 lbs or 1.25 kg. Isolation exercises (curl, lateral raise, fly, extension) = 2.5 lbs or 1.25 kg. If unsure, default to 2.5 lbs. Return ONLY valid JSON with no markdown: { "step": number, "reason": string }. Reason must be 1 short sentence.`,
      messages: [{
        role: 'user',
        content: contextLines,
      }],
    })

    const text = (message.content[0] as { type: string; text: string }).text.trim()
    const parsed = JSON.parse(text)
    return NextResponse.json({ step: parsed.step, reason: parsed.reason })
  } catch {
    return NextResponse.json({ step: 2.5, reason: 'Default recommendation.' })
  }
}
