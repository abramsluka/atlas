import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { subDays } from 'date-fns'
import type { OuraData, WhoopData } from '@/features/health/types'

export interface BentoStats {
  lastWorkout: { name: string; completedAt: string } | null
  workoutCount7d: number
  workoutDays7d: boolean[]   // 7 items: index 0 = 6 days ago, index 6 = today
  recentTrainingCheckin: { date: string; activity: string } | null
  todayCalories: number
  todayProtein: number
  recoveryScore: number | null   // oura readiness or whoop recovery
  sleepScore: number | null      // oura sleep score
  lastJournal: { snippet: string; createdAt: string; mood: number | null } | null
}

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const sevenDaysAgo = subDays(new Date(), 7).toISOString()

  const [lastWorkoutRes, workoutDaysRes, foodRes, wearableRes, journalRes, checkinRes] = await Promise.all([
    db.from('workouts')
      .select('id, name, completed_at')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    db.from('workouts')
      .select('completed_at')
      .eq('user_id', user.id)
      .not('completed_at', 'is', null)
      .gte('completed_at', sevenDaysAgo),

    db.from('food_logs')
      .select('calories, protein_g')
      .eq('user_id', user.id)
      .eq('date', today),

    db.from('wearable_data')
      .select('data, provider')
      .eq('user_id', user.id)
      .eq('date', today)
      .in('provider', ['oura', 'whoop']),

    db.from('journal_entries')
      .select('body, audio_transcript, created_at, mood')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),

    db.from('daily_checkins')
      .select('date, evening_actual_training')
      .eq('user_id', user.id)
      .not('evening_actual_training', 'is', null)
      .neq('evening_actual_training', '')
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Last workout
  const lw = lastWorkoutRes.data
  const lastWorkout = lw
    ? { name: (lw.name as string | null) ?? 'Workout', completedAt: lw.completed_at as string }
    : null

  // Workout days breakdown (last 7 days: index 0 = 6 days ago, index 6 = today)
  const workoutRows = (workoutDaysRes.data ?? []) as Array<{ completed_at: string }>
  const workoutDays7d: boolean[] = Array(7).fill(false)
  const nowMs = Date.now()
  for (const row of workoutRows) {
    const daysAgo = Math.floor((nowMs - new Date(row.completed_at).getTime()) / (1000 * 60 * 60 * 24))
    if (daysAgo >= 0 && daysAgo < 7) workoutDays7d[6 - daysAgo] = true
  }
  const workoutCount7d = workoutDays7d.filter(Boolean).length

  // Most recent training check-in (fallback when no formal workout)
  const ci = checkinRes.data as { date: string; evening_actual_training: string } | null
  const recentTrainingCheckin = ci ? { date: ci.date, activity: ci.evening_actual_training } : null

  // Today's food totals
  const logs = (foodRes.data ?? []) as Array<{ calories: number | null; protein_g: number | null }>
  const todayCalories = Math.round(logs.reduce((s, l) => s + (l.calories ?? 0), 0))
  const todayProtein = Math.round(logs.reduce((s, l) => s + (l.protein_g ?? 0), 0))

  // Recovery + sleep from wearable
  let recoveryScore: number | null = null
  let sleepScore: number | null = null
  const rows = (wearableRes.data ?? []) as Array<{ provider: string; data: Record<string, unknown> }>
  for (const row of rows) {
    const d = row.data
    if (row.provider === 'oura') {
      const oura = d as OuraData
      if (oura.readiness?.score != null) recoveryScore = oura.readiness.score
      if (oura.sleep?.score != null) sleepScore = oura.sleep.score
      break
    }
    if (row.provider === 'whoop') {
      const whoop = d as WhoopData
      if ((whoop as unknown as { recovery?: { score?: number } }).recovery?.score != null) {
        recoveryScore = (whoop as unknown as { recovery: { score: number } }).recovery.score
      }
      break
    }
  }

  // Last journal entry snippet
  const je = journalRes.data as { body: string; audio_transcript: string | null; created_at: string; mood: number | null } | null
  let lastJournal: BentoStats['lastJournal'] = null
  if (je) {
    const text = (je.body?.trim() || je.audio_transcript?.trim() || '')
    lastJournal = {
      snippet: text.slice(0, 80) + (text.length > 80 ? '…' : ''),
      createdAt: je.created_at,
      mood: je.mood,
    }
  }

  const stats: BentoStats = {
    lastWorkout,
    workoutCount7d,
    workoutDays7d,
    recentTrainingCheckin,
    todayCalories,
    todayProtein,
    recoveryScore,
    sleepScore,
    lastJournal,
  }

  return NextResponse.json(stats)
}
