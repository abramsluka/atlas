import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getOuraContextRange, summarizeOuraForCoach } from '@/features/health/ouraContext'
import { fetchGymLogs, groupByDay, sessionLabel, sessionVolumeLbs } from '@/lib/gymActivity'
import { generateText } from 'ai'
import { getModelForFeature, suggestedProviderFor } from '@/lib/aiProvider'
import { noKeyResponse } from '@/lib/userKeys'
import { isAiLimitError, aiLimitResponse } from '@/lib/aiErrors'
import { getProfileBlock } from '@/lib/profile/getProfileBlock'

function getMostRecentSunday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  const day = d.getDay() // 0 = Sunday
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

export async function POST() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const today = toLocalDate(TZ)
  const weekOf = getMostRecentSunday(today)
  const sevenDaysAgo = formatInTimeZone(subDays(new Date(), 7), TZ, 'yyyy-MM-dd')

  // Check if report already exists — cached reads don't need an API key
  const existing = await db.from('weekly_reports').select('id, report_text, week_of').eq('user_id', user.id).eq('week_of', weekOf).maybeSingle()
  if (existing.data) return NextResponse.json({ report_text: existing.data.report_text, week_of: existing.data.week_of })

  const resolved = await getModelForFeature(user.id, 'coaching')
  if (!resolved) return noKeyResponse(suggestedProviderFor('coaching'))

  // Fetch all data in parallel
  const [workoutsRes, ouraData, waterRes, weightRes, foodRes, jotsRes, contextRes, prevReportRes, profileBlock] = await Promise.all([
    fetchGymLogs(db, user.id, new Date(sevenDaysAgo).toISOString()),
    getOuraContextRange(db, user.id, sevenDaysAgo, today),
    db.from('water_logs').select('date, amount_oz').eq('user_id', user.id).gte('date', sevenDaysAgo).order('date', { ascending: false }),
    db.from('body_weights').select('date_key, weight').eq('user_id', user.id).gte('date_key', sevenDaysAgo).order('date_key', { ascending: false }),
    db.from('food_logs').select('date, item_name, calories, protein_g').eq('user_id', user.id).gte('date', sevenDaysAgo).order('date', { ascending: false }),
    db.from('jots').select('content, created_at').eq('user_id', user.id).gte('created_at', new Date(sevenDaysAgo).toISOString()).order('created_at', { ascending: false }),
    db.from('mentor_context').select('primary_goal').eq('user_id', user.id).maybeSingle(),
    db.from('weekly_reports').select('report_text, week_of').eq('user_id', user.id).order('week_of', { ascending: false }).limit(1).maybeSingle(),
    getProfileBlock(db, user.id, 'mentor'),
  ])

  // Format data
  const trainingDays = groupByDay(workoutsRes, iso => formatInTimeZone(new Date(iso), TZ, 'EEE MMM d'))
  const workoutSummary = trainingDays.size
    ? `${trainingDays.size} training days\n${[...trainingDays.entries()].map(([day, logs]) =>
        `  ${day}: ${sessionLabel(logs, 6)} — ${logs.length} sets, ${Math.round(sessionVolumeLbs(logs)).toLocaleString()} lbs volume`
      ).join('\n')}`
    : 'No training this week'

  const ouraSummary = summarizeOuraForCoach(ouraData) ?? 'No Oura data'

  const waterByDate: Record<string, number> = {}
  for (const r of (waterRes.data ?? []) as Array<{date: string; amount_oz: number}>) {
    waterByDate[r.date] = (waterByDate[r.date] ?? 0) + r.amount_oz
  }
  const waterSummary = Object.keys(waterByDate).length
    ? Object.entries(waterByDate).map(([d, oz]) => `  ${d}: ${(oz/33.814).toFixed(1)}L`).join('\n')
    : 'No water logs'

  const weightSummary = (weightRes.data ?? []).length
    ? (weightRes.data as Array<{date_key: string; weight: number}>).map(r => `  ${r.date_key}: ${r.weight} lbs`).join('\n')
    : 'No weight logs'

  const foodSummary = (foodRes.data ?? []).length
    ? (foodRes.data as Array<{date: string; item_name: string; calories: number | null}>).slice(0, 15).map(r => `  ${r.date}: ${r.item_name}${r.calories ? ` (${r.calories} kcal)` : ''}`).join('\n')
    : 'No food logs'

  const jotsSummary = (jotsRes.data ?? []).length
    ? (jotsRes.data as Array<{content: string; created_at: string}>).map(j => `  [${new Date(j.created_at).toDateString()}] ${j.content}`).join('\n')
    : 'No jots this week'

  const prevReport = prevReportRes.data
  const prevReportSection = prevReport ? `\nPREVIOUS WEEK'S REPORT (${prevReport.week_of}):\n${prevReport.report_text.slice(0, 500)}...` : ''

  let reportText: string
  try {
    const generated = await generateText({
      model: resolved.model,
      maxOutputTokens: 1200,
      system: `You are Atlas. Generate Luka's weekly life report for the week ending ${today}. This is a real document he will read and keep. Be specific, use actual numbers, and give him genuine insight — not a summary of what happened, but what it means. Structure it exactly as shown with these sections using markdown bold headers: **The Week in Numbers**, **What Went Well**, **What to Watch**, **Goal Check-In**, **Focus for Next Week**.`,
      messages: [{
        role: 'user',
        content: `Generate my weekly report.

PRIMARY GOAL: ${contextRes.data?.primary_goal ?? 'not set'}
${profileBlock || 'ABOUT ME: no profile yet'}

WORKOUTS:
${workoutSummary}

OURA RECOVERY:
${ouraSummary}

WATER:
${waterSummary}

WEIGHT:
${weightSummary}

FOOD:
${foodSummary}

JOTS (thoughts captured this week):
${jotsSummary}
${prevReportSection}`,
      }],
    })
    reportText = generated.text
  } catch (err) {
    if (isAiLimitError(err)) return aiLimitResponse()
    throw err
  }

  await db.from('weekly_reports').upsert({ user_id: user.id, week_of: weekOf, report_text: reportText }, { onConflict: 'user_id,week_of' })

  return NextResponse.json({ report_text: reportText, week_of: weekOf })
}
