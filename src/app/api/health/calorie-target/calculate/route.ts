import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()

  const [profileResult, latestWeightResult] = await Promise.all([
    db.from('health_profile').select('*').eq('user_id', user.id).maybeSingle(),
    db
      .from('body_weight_logs')
      .select('weight_lbs, logged_at')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const profile = profileResult.data
  if (!profile) return NextResponse.json({ error: 'Health profile not found' }, { status: 404 })
  if (!profile.target_weight_lbs) return NextResponse.json({ error: 'target_weight_lbs not set' }, { status: 400 })
  if (!profile.cut_pace) return NextResponse.json({ error: 'cut_pace not set' }, { status: 400 })

  const currentWeight = latestWeightResult.data?.weight_lbs ?? profile.weight_lbs
  if (!currentWeight) return NextResponse.json({ error: 'No weight data found' }, { status: 400 })

  const paceLabel = { slow: '0.5 lb/week', moderate: '1 lb/week', aggressive: '1.5 lb/week' }[profile.cut_pace as string] ?? '1 lb/week'

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `You are a nutrition calculator. Use the Mifflin-St Jeor formula to estimate TDEE, then apply the deficit for the target pace. For protein: 1g per lb of current body weight (muscle preservation during cut). For carbs: fill remaining calories after protein (4 cal/g each) with fat rounding to ~25% of calories. Return JSON only with fields: daily_calories (integer), protein_g (integer), carbs_g (integer), reasoning (1-2 sentences, plain text, mention the weight and pace used).`,
    messages: [
      {
        role: 'user',
        content: `Calculate daily calorie and macro targets:
- Current weight: ${currentWeight} lbs
- Target weight: ${profile.target_weight_lbs} lbs
- Cut pace: ${profile.cut_pace} (${paceLabel} loss)
- Age: ${profile.age ?? 'unknown'}
- Sex: ${profile.sex ?? 'unknown'}
- Activity: ${profile.activity_hours_per_week ?? 3} hours/week

Return JSON: { "daily_calories": number, "protein_g": number, "carbs_g": number, "reasoning": "string" }`,
      },
    ],
  })

  const raw = (response.content[0] as { text: string }).text
  let parsed: { daily_calories: number; protein_g: number; carbs_g: number; reasoning: string }

  try {
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    return NextResponse.json({ error: 'AI returned invalid JSON', raw }, { status: 422 })
  }

  const now = new Date().toISOString()

  // upsert the linked weight-loss goal
  let linkedGoalId = profile.linked_target_goal_id ?? null

  const goalTitle = `Reach ${profile.target_weight_lbs} lbs`

  if (linkedGoalId) {
    await db
      .from('goals')
      .update({
        title: goalTitle,
        target_value: Number(profile.target_weight_lbs),
        current_value: Number(currentWeight),
        updated_at: now,
      })
      .eq('id', linkedGoalId)
  } else {
    const { data: newGoal } = await db
      .from('goals')
      .insert({
        user_id: user.id,
        type: 'numeric',
        title: goalTitle,
        target_value: Number(profile.target_weight_lbs),
        current_value: Number(currentWeight),
        start_value: Number(currentWeight),
        direction: 'descending',
        unit: 'lbs',
      })
      .select()
      .single()
    linkedGoalId = newGoal?.id ?? null
  }

  await db
    .from('health_profile')
    .update({
      daily_calorie_target: Math.round(parsed.daily_calories),
      daily_protein_target_g: Math.round(parsed.protein_g),
      daily_carbs_target_g: Math.round(parsed.carbs_g),
      target_reasoning: parsed.reasoning,
      target_calc_weight_lbs: currentWeight,
      target_calculated_at: now,
      linked_target_goal_id: linkedGoalId,
      updated_at: now,
    })
    .eq('user_id', user.id)

  return NextResponse.json({
    daily_calories: Math.round(parsed.daily_calories),
    protein_g: Math.round(parsed.protein_g),
    carbs_g: Math.round(parsed.carbs_g),
    reasoning: parsed.reasoning,
  })
}
