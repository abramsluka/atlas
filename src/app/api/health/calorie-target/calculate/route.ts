import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateText } from 'ai'
import { getModelForFeature, suggestedProviderFor } from '@/lib/aiProvider'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'

type Goal = 'cut' | 'recomp' | 'lean_bulk' | 'maintain'

// activity_level → hrs/week for Mifflin-St Jeor multiplier
const ACTIVITY_HOURS: Record<string, number> = {
  sedentary:   1,
  light:       3,
  moderate:    7,
  very_active: 14,
}

function activityMultiplier(hrsPerWeek: number): number {
  if (hrsPerWeek < 2)  return 1.2
  if (hrsPerWeek < 5)  return 1.375
  if (hrsPerWeek < 10) return 1.55
  return 1.725
}

function tdeeByWeight(weightLbs: number, hrsPerWeek: number): number {
  const multipliers = [14.0, 15.0, 16.0, 17.5]
  const idx = hrsPerWeek < 2 ? 0 : hrsPerWeek < 5 ? 1 : hrsPerWeek < 10 ? 2 : 3
  return Math.round(weightLbs * multipliers[idx])
}

const CUT_DEFICIT: Record<string, number> = { slow: 250, moderate: 500, aggressive: 750 }
const CUT_FAT_PCT: Record<string, number> = { slow: 0.25, moderate: 0.28, aggressive: 0.35 }
const BULK_SURPLUS: Record<string, number> = { slow: 200, moderate: 300 }

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

  const goal: Goal = (profile.fitness_goal as Goal) ?? 'cut'

  // Resolve activity hrs — activity_hrs_per_week is the field the Health
  // settings modal edits (and the water target reads), so it wins. The
  // activity_level enum is legacy: no UI writes it, kept only as a fallback.
  const activityHrs: number =
    profile.activity_hrs_per_week != null
      ? profile.activity_hrs_per_week
      : (ACTIVITY_HOURS[profile.activity_level as string] ?? 3)

  const currentWeight: number = latestWeightResult.data?.weight_lbs ?? profile.weight_lbs
  if (!currentWeight) return NextResponse.json({ error: 'No weight data found' }, { status: 400 })

  // For cut/lean_bulk, target_weight is required. For recomp/maintain it's optional.
  if ((goal === 'cut' || goal === 'lean_bulk') && !profile.target_weight_lbs) {
    return NextResponse.json({ error: 'target_weight_lbs required for this goal' }, { status: 400 })
  }
  if (goal === 'cut' && !profile.cut_pace) {
    return NextResponse.json({ error: 'cut_pace not set' }, { status: 400 })
  }

  // ── Calculate TDEE ────────────────────────────────────────────────────────
  const weightKg = currentWeight / 2.20462
  let tdee: number
  if (profile.height_cm && profile.age && profile.sex && profile.sex !== 'o') {
    const sexOffset = profile.sex === 'm' ? 5 : -161
    const bmr = 10 * weightKg + 6.25 * profile.height_cm - 5 * profile.age + sexOffset
    tdee = Math.round(bmr * activityMultiplier(activityHrs))
  } else {
    tdee = tdeeByWeight(currentWeight, activityHrs)
  }

  // ── Macro calculation by goal ─────────────────────────────────────────────
  let dailyCalories: number
  let protein_g: number
  let fat_g: number
  let carbs_g: number
  let goalLabel: string
  let paceLabel: string

  if (goal === 'cut') {
    const pace = (profile.cut_pace as string) ?? 'moderate'
    const deficit = CUT_DEFICIT[pace] ?? 500
    dailyCalories = Math.max(1200, tdee - deficit)
    protein_g = Math.round(currentWeight)                       // 1g/lb — preserve muscle
    const fatPct = CUT_FAT_PCT[pace] ?? 0.28
    fat_g = Math.round((dailyCalories * fatPct) / 9)
    carbs_g = Math.max(0, Math.round((dailyCalories - protein_g * 4 - fat_g * 9) / 4))
    goalLabel = 'Cut'
    paceLabel = { slow: '0.5 lb/week', moderate: '1 lb/week', aggressive: '1.5 lb/week' }[pace] ?? '1 lb/week'

  } else if (goal === 'recomp') {
    dailyCalories = tdee                                        // maintenance
    protein_g = Math.round(currentWeight)                       // 1g/lb — critical for recomp
    fat_g = Math.round((dailyCalories * 0.25) / 9)             // 25% from fat
    carbs_g = Math.max(0, Math.round((dailyCalories - protein_g * 4 - fat_g * 9) / 4))
    goalLabel = 'Body Recomposition'
    paceLabel = 'maintenance calories'

  } else if (goal === 'lean_bulk') {
    const pace = (profile.cut_pace as string) ?? 'slow'        // slow=conservative, moderate=moderate surplus
    const surplus = BULK_SURPLUS[pace] ?? 200
    dailyCalories = tdee + surplus
    protein_g = Math.round(currentWeight * 0.9)                // 0.9g/lb — support growth
    fat_g = Math.round((dailyCalories * 0.25) / 9)
    carbs_g = Math.max(0, Math.round((dailyCalories - protein_g * 4 - fat_g * 9) / 4))
    goalLabel = 'Lean Bulk'
    paceLabel = pace === 'moderate' ? '+300 cal/day surplus' : '+200 cal/day surplus'

  } else {
    // maintain
    dailyCalories = tdee
    protein_g = Math.round(currentWeight * 0.75)               // 0.75g/lb — adequate maintenance
    fat_g = Math.round((dailyCalories * 0.30) / 9)
    carbs_g = Math.max(0, Math.round((dailyCalories - protein_g * 4 - fat_g * 9) / 4))
    goalLabel = 'Maintain'
    paceLabel = 'maintenance calories'
  }

  // ── Claude writes the reasoning sentence ─────────────────────────────────
  const resolved = await getModelForFeature(user.id, 'coaching', 'fast')
  if (!resolved) return noKeyResponse(suggestedProviderFor('coaching'))

  const contextLines = [
    `Goal: ${goalLabel}`,
    `Current weight: ${currentWeight} lbs`,
    profile.target_weight_lbs ? `Target weight: ${profile.target_weight_lbs} lbs` : null,
    `Pace: ${paceLabel}`,
    `Estimated TDEE: ${tdee} kcal`,
    `Daily target: ${dailyCalories} kcal, ${protein_g}g protein, ${carbs_g}g carbs, ${fat_g}g fat`,
    `Activity: ${activityHrs} hrs/week training`,
  ].filter(Boolean).join('. ')

  const goalContext: Record<Goal, string> = {
    cut: 'This is a caloric deficit plan to lose fat while preserving muscle.',
    recomp: 'Body recomposition: maintenance calories with high protein. The scale may not move but body composition will improve with consistent training.',
    lean_bulk: 'Lean bulk: slight caloric surplus to build muscle while minimizing fat gain. Patience is key — this is slow by design.',
    maintain: 'Maintenance: keep current weight, stay fueled, hit protein to preserve muscle.',
  }

  let reasoningText: string
  try {
    const generated = await generateText({
      model: resolved.model,
      maxOutputTokens: 120,
      system: `You are a nutrition coach. Write 1-2 plain sentences explaining these pre-calculated macro targets to the user. Be specific and mention the goal. ${goalContext[goal]} Do not recalculate anything.`,
      messages: [{ role: 'user', content: contextLines }],
    })
    reasoningText = generated.text
  } catch (err) {
    if (isAiLimitError(err)) return aiLimitResponse()
    throw err
  }

  const reasoning = reasoningText.trim()

  // ── Update linked goal for cut/lean_bulk ─────────────────────────────────
  const now = new Date().toISOString()
  let linkedGoalId = profile.linked_target_goal_id ?? null

  if ((goal === 'cut' || goal === 'lean_bulk') && profile.target_weight_lbs) {
    const goalTitle = goal === 'lean_bulk'
      ? `Bulk to ${profile.target_weight_lbs} lbs`
      : `Reach ${profile.target_weight_lbs} lbs`
    const direction = goal === 'lean_bulk' ? 'ascending' : 'descending'

    if (linkedGoalId) {
      await db.from('goals').update({
        title: goalTitle,
        target_value: Number(profile.target_weight_lbs),
        current_value: Number(currentWeight),
        updated_at: now,
      }).eq('id', linkedGoalId).eq('user_id', user.id)
    } else {
      const { data: newGoal } = await db.from('goals').insert({
        user_id: user.id,
        type: 'numeric',
        title: goalTitle,
        target_value: Number(profile.target_weight_lbs),
        current_value: Number(currentWeight),
        start_value: Number(currentWeight),
        direction,
        unit: 'lbs',
      }).select().single()
      linkedGoalId = newGoal?.id ?? null
    }
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
