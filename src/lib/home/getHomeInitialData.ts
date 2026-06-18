import { createServiceClient } from '@/lib/supabase/server'
import { computeBentoStats, type BentoStats } from '@/lib/home/bentoStats'
import { computeStreaks, type Streaks } from '@/lib/home/streaks'

type DB = ReturnType<typeof createServiceClient>

type Verdict = 'GREEN' | 'YELLOW' | 'RED'
export interface TodaysCallCached { color: Verdict; headline: string; bullets: string[] }
export interface WeeklyReportRow { id: string; week_of: string; report_text: string; created_at: string }

// `undefined` for a field means "the server couldn't load it" → the client card
// falls back to its own fetch (current behavior). A non-undefined value (incl.
// null / []) means the server resolved it and the client should skip its fetch.
export interface HomeInitialData {
  bento?: BentoStats
  todaysCall?: TodaysCallCached | null
  briefing?: string | null
  weeklyReports?: WeeklyReportRow[]
  streaks?: Streaks
}

// Runs all home-page reads in parallel, server-side, colocated with Supabase —
// so the browser doesn't make several separate cross-region round trips on mount.
export async function getHomeInitialData(db: DB, userId: string, today: string, tz: string): Promise<HomeInitialData> {
  const [bentoR, callR, briefR, weeklyR, streaksR] = await Promise.allSettled([
    computeBentoStats(db, userId, today),
    db.from('todays_call').select('color, headline, bullets').eq('user_id', userId).eq('date', today).maybeSingle(),
    db.from('daily_briefings').select('content').eq('user_id', userId).eq('date', today).maybeSingle(),
    db.from('weekly_reports').select('id, week_of, report_text, created_at').eq('user_id', userId).order('week_of', { ascending: false }).limit(12),
    computeStreaks(db, userId, tz),
  ])

  return {
    bento: bentoR.status === 'fulfilled' ? bentoR.value : undefined,
    todaysCall: callR.status === 'fulfilled'
      ? ((callR.value.data as TodaysCallCached | null) ?? null)
      : undefined,
    briefing: briefR.status === 'fulfilled'
      ? (((briefR.value.data as { content: string | null } | null)?.content) ?? null)
      : undefined,
    weeklyReports: weeklyR.status === 'fulfilled'
      ? ((weeklyR.value.data as WeeklyReportRow[] | null) ?? [])
      : undefined,
    streaks: streaksR.status === 'fulfilled' ? streaksR.value : undefined,
  }
}
