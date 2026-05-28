import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

// ── TDEE multiplier (kcal per lb body weight) based on weekly activity hours ──
// Source: body-weight rule-of-thumb, used when height is unavailable for
// Mifflin-St Jeor. Conservative estimates to avoid over-estimating deficit.
function tdeeMultiplier(activityHrsPerWeek: number): number {
  if (activityHrsPerWeek < 2)  return 14.0  // sedentary
  if (activityHrsPerWeek < 5)  return 15.0  // lightly active
  if (activityHrsPerWeek < 10) return 16.0  // moderately active
  return 17.5                               // very active
}

// ── Daily calorie deficit per cut pace ────────────────────────────────────────
// Based on ~3,500 kcal per lb of fat
const DEFICIT_KCAL: Record<string, number> = {
  slow:       250,  // 0.5 lb/week
  moderate:   500,  // 1.0 lb/week
  aggressive: 750,  // 1.5 lb/week
}

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

  const currentWeight: number = latestWeightResult.data?.weight_lbs ?? profile.weight_lbs
  if (!currentWeight) return NextResponse.json({ error: 'No weight data found' }, { status: 400 })

  // ── Deterministic calculation ─────────────────────────────────────────────

  // Fix: field name is activity_hrs_per_week not activity_hours_per_week
  const activityHrs: number = profile.activity_hrs_per_week ?? 3
  const tdee = Math.round(currentWeight * tdeeMultiplier(activityHrs))

  const deficit = DEFICIT_KCAL[profile.cut_pace as string] ?? 500
  const dailyCalories = Math.max(1200, tdee - deficit) // floor at 1200 kcal — safety minimum

  // Protein: 1g per lb body weight (muscle preservation during cut)
  // Research: higher end of recommended range for active individuals cutting
  const protein_g = Math.round(currentWeight)

  // Fat: 25% of total calories (hormonal/satiety floor)
  const fat_kcal = dailyCalories * 0.25
  const fat_g = Math.round(fat_kcal / 9)

  // Carbs: fill remainder (fuels training performance)
  const protein_kcal = protein_g * 4
  const carbs_kcal = dailyCalories - protein_kcal - fat_kcal
  const carbs_g = Math.max(0, Math.round(carbs_kcal / 4))

  const paceLabel = { slow: '0.5 lb/week', moderate: '1 lb/week', aggressive: '1.5 lb/week' }[profile.cut_pace as string] ?? '1 lb/week'

  // ── Claude writes the reasoning sentence only ─────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const reasoningRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 120,
    system: 'You are a nutrition coach. Write 1-2 plain sentences explaining these pre-calculated macro targets to the user. Be specific — mention the weight, pace, and calorie number. Do not recalculate anything.',
    messages: [{
      role: 'user',
      content: `Current weight: ${currentWeight} lbs. Target: ${profile.target_weight_lbs} lbs. Pace: ${paceLabel}. Estimated TDEE: ${tdee} kcal. Deficit: ${deficit} kcal/day. Targets: ${dailyCalories} kcal, ${protein_g}g protein, ${carbs_g}g carbs, ${fat_g}g fat. Activity: ${activityHrs} hrs/week.`,
    }],
  })

  const reasoning = (reasoningRes.content[0] as { text: string }).text.trim()

  // ── Upsert the linked weight-loss goal ────────────────────────────────────
  const now = new Date().toISOString()
  let linkedGoalId = profile.linked_target_goal_id ?? null
  const goalTitle = `Reach ${profile.target_weight_lbs} lbs`

  if (linkedGoalId) {
    await db.from('goals').update({
      title: goalTitle,
      target_value: Number(profile.target_weight_lbs),
      current_value: Number(currentWeight),
      updated_at: now,
    }).eq('id', linkedGoalId)
  } else {
    const { data: newGoal } = await db.from('goals').insert({
      user_id: user.id,
      type: 'numeric',
      title: goalTitle,
      target_value: Number(profile.target_weight_lbs),
      current_value: Number(currentWeight),
      start_value: Number(currentWeight),
      direction: 'descending',
      unit: 'lbs',
    }).select().single()
    linkedGoalId = newGoal?.id ?? null
  }

  await db.from('health_profile').update({
    daily_calorie_target: dailyCalories,
    daily_protein_target_g: protein_g,
    daily_carbs_target_g: carbs_g,
    target_reasoning: reasoning,
    target_calc_weight_lbs: currentWeight,
    target_calculated_at: now,
    linked_target_goal_id: linkedGoalId,
    updated_at: now,
  }).eq('user_id', user.id)

  return NextResponse.json({ daily_calories: dailyCalories, protein_g, carbs_g, reasoning })
}
