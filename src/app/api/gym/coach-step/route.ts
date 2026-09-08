import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateText } from 'ai'
import { getModelForFeature, suggestedProviderFor } from '@/lib/aiProvider'
import { noKeyResponse } from '@/lib/userKeys'
import { parseJsonLoose } from '@/lib/parseJsonLoose'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'

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

  const resolved = await getModelForFeature(user.id, 'coaching', 'fast')
  if (!resolved) return noKeyResponse(suggestedProviderFor('coaching'))

  try {
    const { text } = await generateText({
      model: resolved.model,
      maxOutputTokens: 100,
      system: `You are an expert strength coach. Given an exercise name and weight unit, recommend a weight increment step size — the amount to add when the user is ready to progress. Use these guidelines: compound barbell lifts (squat, deadlift, bench, row, OHP) = 5 lbs or 2.5 kg. Smaller compounds and cable machines = 2.5 lbs or 1.25 kg. Isolation exercises (curl, lateral raise, fly, extension) = 2.5 lbs or 1.25 kg. If unsure, default to 2.5 lbs. Return ONLY valid JSON with no markdown: { "step": number, "reason": string }. Reason must be 1 short sentence.`,
      messages: [{
        role: 'user',
        content: contextLines,
      }],
    })

    // Gemini often fences JSON; a bare JSON.parse would silently fall through
    // to the default step below.
    const parsed = parseJsonLoose<{ step?: number; reason?: string }>(text)
    if (!parsed) throw new Error('no JSON in model response')
    return NextResponse.json({ step: parsed.step, reason: parsed.reason })
  } catch (err) {
    // A usage/spend cap or rate limit should surface to the user, not be masked
    // by the silent default fallback below (this recommendation is user-facing).
    if (isAiLimitError(err)) return aiLimitResponse()
    return NextResponse.json({ step: 2.5, reason: 'Default recommendation.' })
  }
}
