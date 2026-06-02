import { NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'
import type { OuraData, WhoopData } from '@/features/health/types'

export async function POST(_request: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const db = createServiceClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const now = new Date()

  const [
    checkinRes,
    recentWorkoutsRes,
    habitsRes,
    habitLogsRes,
    goalsRes,
    waterTodayRes,
    supplementLogsRes,
    journalRes,
    debloatTodayRes,
    debloatHistoryRes,
    bodyweightRes,
    ouraWearableRes,
    whoopWearableRes,
  ] = await Promise.all([
    db.from('daily_checkins')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),

    db.from('gym_logs')
      .select('logged_at, exercise_id, weight, reps')
      .eq('user_id', user.id)
      .order('logged_at', { ascending: false })
      .limit(50),

    db.from('goals')
      .select('id, title, type')
      .eq('user_id', user.id)
      .eq('type', 'habit')
      .is('completed_at', null),

    db.from('habit_logs')
      .select('goal_id, date, completed')
      .eq('user_id', user.id)
      .gte('date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
      .order('date', { ascending: false }),

    db.from('goals')
      .select('id, title, type, target_value, current_value, unit, due_date')
      .eq('user_id', user.id)
      .neq('type', 'habit')
      .is('completed_at', null),

    db.from('water_logs')
      .select('amount_oz')
      .eq('user_id', user.id)
      .eq('date', today),

    db.from('supplement_logs')
      .select('supplement_id')
      .eq('user_id', user.id)
      .eq('date', today),

    db.from('journal_entries')
      .select('created_at, content')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(3),

    db.from('debloat_logs')
      .select('bloat_level, checklist')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle(),

    db.from('debloat_logs')
      .select('date, bloat_level')
      .eq('user_id', user.id)
      .gte('date', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))
      .order('date', { ascending: false }),

    db.from('body_weights')
      .select('weight, date_key')
      .eq('user_id', user.id)
      .order('date_key', { ascending: false })
      .limit(14),

    db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'oura').eq('date', today).maybeSingle(),
    db.from('wearable_data').select('data').eq('user_id', user.id).eq('provider', 'whoop').eq('date', today).maybeSingle(),
  ])

  const checkin = checkinRes.data

  const lastWorkout = recentWorkoutsRes.data?.[0]
  const daysSinceWorkout = lastWorkout?.logged_at
    ? Math.floor((now.getTime() - new Date(lastWorkout.logged_at).getTime()) / 86400000)
    : null

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000)
  const workoutDaysThisWeek = new Set(
    (recentWorkoutsRes.data ?? [])
      .filter(w => w.logged_at && new Date(w.logged_at) >= sevenDaysAgo)
      .map(w => new Date(w.logged_at!).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }))
  ).size

  const habits = habitsRes.data ?? []
  const habitLogs = habitLogsRes.data ?? []
  const habitSummary = habits.map(h => {
    const logs = habitLogs.filter(l => l.goal_id === h.id && l.completed)
    const sortedDates = [...new Set(logs.map(l => l.date))].sort().reverse()
    let streak = 0
    const d = new Date(today)
    for (const date of sortedDates) {
      const check = d.toISOString().slice(0, 10)
      if (date === check) {
        streak++
        d.setDate(d.getDate() - 1)
      } else break
    }
    const doneToday = habitLogs.some(l => l.goal_id === h.id && l.date === today && l.completed)
    return { title: h.title, streak, doneToday }
  })
  const habitsCompletedToday = habitSummary.filter(h => h.doneToday).length
  const totalHabits = habitSummary.length

  const goals = goalsRes.data ?? []

  const waterOz = Math.round((waterTodayRes.data ?? []).reduce((sum, w) => sum + (w.amount_oz ?? 0), 0))

  const supplementsTaken = supplementLogsRes.data?.length ?? 0

  const lastJournalEntry = journalRes.data?.[0]
  const daysSinceJournal = lastJournalEntry
    ? Math.floor((now.getTime() - new Date(lastJournalEntry.created_at).getTime()) / 86400000)
    : null

  const debloatToday = debloatTodayRes.data
  const debloatHistory = debloatHistoryRes.data ?? []
  const avgBloatWeek = debloatHistory.length
    ? (debloatHistory.reduce((s, d) => s + (d.bloat_level ?? 0), 0) / debloatHistory.filter(d => d.bloat_level).length).toFixed(1)
    : null

  const latestWeight = bodyweightRes.data?.[0]
  const weightTrend = bodyweightRes.data && bodyweightRes.data.length >= 5
    ? ((bodyweightRes.data[0].weight - bodyweightRes.data[4].weight) > 0 ? 'up' : 'down')
    : null

  const ouraToday = ouraWearableRes.data?.data as OuraData | null
  const whoopToday = whoopWearableRes.data?.data as WhoopData | null

  const wearableLines: string[] = []
  if (ouraToday) {
    if (ouraToday.readiness?.score != null) wearableLines.push(`  Oura readiness: ${ouraToday.readiness.score}`)
    if (ouraToday.sleep?.score != null) wearableLines.push(`  Oura sleep score: ${ouraToday.sleep.score}`)
    if (ouraToday.sleep?.average_hrv != null) wearableLines.push(`  Oura HRV: ${Math.round(ouraToday.sleep.average_hrv)}ms`)
    if (ouraToday.sleep?.total_sleep_duration != null) {
      const h = Math.floor(ouraToday.sleep.total_sleep_duration / 3600)
      const m = Math.floor((ouraToday.sleep.total_sleep_duration % 3600) / 60)
      wearableLines.push(`  Oura sleep duration: ${h}h${m}m`)
    }
  }
  if (whoopToday) {
    if (whoopToday.recovery?.score != null) wearableLines.push(`  Whoop recovery: ${whoopToday.recovery.score}%`)
    if (whoopToday.recovery?.hrv_rmssd_milli != null) wearableLines.push(`  Whoop HRV: ${Math.round(whoopToday.recovery.hrv_rmssd_milli)}ms`)
    if (whoopToday.cycle?.strain != null) wearableLines.push(`  Whoop strain: ${whoopToday.cycle.strain.toFixed(1)}`)
    if (whoopToday.cycle?.kilojoule != null) wearableLines.push(`  Whoop calories: ${Math.round(whoopToday.cycle.kilojoule * 0.239)} kcal`)
    if (whoopToday.sleep?.duration_seconds != null) {
      const h = Math.floor(whoopToday.sleep.duration_seconds / 3600)
      const m = Math.floor((whoopToday.sleep.duration_seconds % 3600) / 60)
      wearableLines.push(`  Whoop sleep: ${h}h${m}m`)
    }
  }

  const hour = now.getHours()
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'

  const contextLines: string[] = [
    `Time of day: ${timeOfDay}`,
    `Today: ${today}`,
    '',
    '--- GYM ---',
    daysSinceWorkout === null
      ? 'No workout history recorded yet.'
      : daysSinceWorkout === 0
        ? 'Worked out today.'
        : `Last workout: ${daysSinceWorkout} day${daysSinceWorkout === 1 ? '' : 's'} ago.`,
    `Workout days this week: ${workoutDaysThisWeek}`,
    latestWeight ? `Latest body weight: ${latestWeight.weight} lbs${weightTrend ? ` (trending ${weightTrend} over last 5 entries)` : ''}` : 'No body weight logged.',
    '',
    '--- DAILY CHECK-IN ---',
    checkin?.morning_intent ? `Morning intent: "${checkin.morning_intent}"` : 'No morning intent set.',
    checkin?.evening_actual_training !== null && checkin?.evening_actual_training !== undefined
      ? `Trained today: ${checkin.evening_actual_training ? 'yes' : 'no'}${checkin.evening_reflection ? `. Reflection: "${checkin.evening_reflection}"` : ''}`
      : 'Evening check-in not done yet.',
    '',
    '--- HABITS ---',
    totalHabits === 0
      ? 'No active habits.'
      : `${habitsCompletedToday}/${totalHabits} habits done today.`,
    ...habitSummary.map(h =>
      `  • ${h.title}: ${h.doneToday ? '✓ done today' : '✗ not done'}, current streak ${h.streak} day${h.streak === 1 ? '' : 's'}`
    ),
    '',
    '--- GOALS ---',
    goals.length === 0
      ? 'No active goals.'
      : goals.map(g => {
          if (g.type === 'numeric' && g.target_value != null) {
            const pct = g.current_value != null ? Math.round((g.current_value / g.target_value) * 100) : 0
            return `  • ${g.title}: ${g.current_value ?? 0} / ${g.target_value} ${g.unit ?? ''} (${pct}%)${g.due_date ? `, due ${g.due_date}` : ''}`
          }
          return `  • ${g.title} (${g.type})`
        }).join('\n'),
    '',
    '--- WEARABLES ---',
    wearableLines.length > 0 ? wearableLines.join('\n') : 'No wearable data for today.',
    '',
    '--- HEALTH ---',
    `Water today: ${waterOz > 0 ? `${waterOz} oz` : 'none logged'}`,
    `Supplements taken today: ${supplementsTaken}`,
    '',
    '--- JOURNAL ---',
    daysSinceJournal === null
      ? 'No journal entries yet.'
      : daysSinceJournal === 0
        ? 'Journaled today.'
        : `Last journal entry: ${daysSinceJournal} day${daysSinceJournal === 1 ? '' : 's'} ago.`,
    '',
    '--- DEBLOAT ---',
    debloatToday?.bloat_level
      ? `Today's bloat level: ${debloatToday.bloat_level}/5`
      : 'No bloat level logged today.',
    avgBloatWeek ? `7-day average bloat: ${avgBloatWeek}/5` : '',
  ].filter(l => l !== undefined)

  const context = contextLines.join('\n')

  const systemPrompt = `You are Luka's personal AI coach and the only one who sees the full picture. You have access to his gym data, habits, goals, health tracking, journal, and how his body is feeling. You speak like a brilliant, direct friend who actually knows him — not a wellness app, not a hype bot.

Your job: give him a real daily briefing in 4–6 sentences. Be specific to his actual data. Call out what's going well, what needs attention, and one concrete thing to focus on. If something has been slipping (habits not done, no gym in 4+ days, poor sleep, skipped journaling), name it plainly. If something is going really well (long streak, consistent training, trending weight), acknowledge it genuinely.

Tone: direct, warm, grounded. Like someone who has been watching your data every day and isn't going to bullshit you. No hollow phrases like "great job keeping up with your habits" — be specific. No bullet points, no headers — just a flowing paragraph or two that feels like a voice memo from someone who knows your life.`

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 350,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `Here is my data for today:\n\n${context}\n\nGive me my daily briefing.`,
      },
    ],
  })

  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(new TextEncoder().encode(event.delta.text))
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}
