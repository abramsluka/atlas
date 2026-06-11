import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

// ── Activity multiplier for Mifflin-St Jeor TDEE ────────────────────────────
function activityMultiplier(hrsPerWeek: number): number {
  if (hrsPerWeek < 2)  return 1.2    // sedentary
  if (hrsPerWeek < 5)  return 1.375  // lightly active
  if (hrsPerWeek < 10) return 1.55   // moderately active
  return 1.725                       // very active
}

// ── Fallback: body-weight multiplier when height/age/sex unavailable ─────────
function tdeeByWeight(weightLbs: number, hrsPerWeek: number): number {
  const multipliers = [14.0, 15.0, 16.0, 17.5]
  const idx = hrsPerWeek < 2 ? 0 : hrsPerWeek < 5 ? 1 : hrsPerWeek < 10 ? 2 : 3
  return Math.round(weightLbs * multipliers[idx])
}

// ── Daily calorie deficit per cut pace ────────────────────────────────────────
const DEFICIT_KCAL: Record<string, number> = {
  slow:       250,  // 0.5 lb/week
  moderate:   500,  // 1.0 lb/week
  aggressive: 750,  // 1.5 lb/week
}

// ── Fat % of calories per cut pace (more fat = fewer carbs on cut) ───────────
const FAT_PCT: Record<string, number> = {
  slow:       0.25,
  moderate:   0.28,
  aggressive: 0.35,
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

  const activityHrs: number = profile.activity_hrs_per_week ?? 3
  const weightKg = currentWeight / 2.20462

  // Mifflin-St Jeor BMR if we have height + age + sex, otherwise body-weight estimate
  let tdee: number
  if (profile.height_cm && profile.age && profile.sex && profile.sex !== 'o') {
    const sexOffset = profile.sex === 'm' ? 5 : -161
    const bmr = 10 * weightKg + 6.25 * profile.height_cm - 5 * profile.age + sexOffset
    tdee = Math.round(bmr * activityMultiplier(activityHrs))
  } else {
    tdee = tdeeByWeight(currentWeight, activityHrs)
  }

  const deficit = DEFICIT_KCAL[profile.cut_pace as string] ?? 500
  const dailyCalories = Math.max(1200, tdee - deficit)

  // Protein: 1g/lb body weight (muscle preservation — upper end for active cutters)
  const protein_g = Math.round(currentWeight)
  const protein_kcal = protein_g * 4

  // Fat: higher % on aggressive cuts → fewer carbs, better satiety/satiation
  const fatPct = FAT_PCT[profile.cut_pace as string] ?? 0.28
  const fat_kcal = dailyCalories * fatPct
  const fat_g = Math.round(fat_kcal / 9)

  // Carbs: fill remainder
  const carbs_kcal = dailyCalories - protein_kcal - fat_kcal
  const carbs_g = Math.max(0, Math.round(carbs_kcal / 4))

  const paceLabel = { slow: '0.5 lb/week', moderate: '1 lb/week', aggressive: '1.5 lb/week' }[profile.cut_pace as string] ?? '1 lb/week'

  // ── Claude writes the reasoning sentence only ─────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const reasoningRes = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
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
