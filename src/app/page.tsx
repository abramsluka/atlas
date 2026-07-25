import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import HomeClient from './HomeClient'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'
import { getHomeInitialData } from '@/lib/home/getHomeInitialData'

export default async function HomePage() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  // Fetch the checkin + all home-card data (plus the dashboard name) in parallel,
  // server-side (next to Supabase) so the browser doesn't make ~5 cross-region
  // calls on mount.
  const [checkinRes, home, settingsRes] = await Promise.all([
    db.from('daily_checkins').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
    getHomeInitialData(db, user.id, today, tz),
    db.from('user_settings').select('first_name').eq('user_id', user.id).maybeSingle(),
  ])

  // "Sam's Dashboard" — the user's first name from user_settings (read fresh
  // from the DB, so it never lags behind a stale auth-session cookie). Email
  // local part is only a defensive fallback so the title is never blank.
  const settingsName = (settingsRes.data?.first_name as string | null | undefined)?.trim()
  const rawFirst = settingsName || user.email?.split('@')[0] || 'Your'
  const displayName = rawFirst.charAt(0).toUpperCase() + rawFirst.slice(1)

  return (
    <HomeClient
      today={today}
      timezone={tz}
      displayName={displayName}
      initialCheckin={checkinRes.data ?? null}
      initialBento={home.bento}
      initialTodaysCall={home.todaysCall}
      initialBriefing={home.briefing}
      initialWeeklyReports={home.weeklyReports}
      initialStreaks={home.streaks}
      initialDayPlan={home.dayPlan}
    />
  )
}
