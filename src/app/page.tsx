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

  // "Sam's Dashboard" — first name from the account's full_name (set in
  // Supabase user_metadata), falling back to the email local part.
  const fullName = (user.user_metadata?.full_name as string | undefined)?.trim()
  const firstName = fullName ? fullName.split(/\s+/)[0] : (user.email?.split('@')[0] ?? 'Your')
  const displayName = firstName.charAt(0).toUpperCase() + firstName.slice(1)

  // Fetch the checkin + all home-card data in parallel, server-side (next to
  // Supabase) so the browser doesn't make ~5 cross-region calls on mount.
  const [checkinRes, home] = await Promise.all([
    db.from('daily_checkins').select('*').eq('user_id', user.id).eq('date', today).maybeSingle(),
    getHomeInitialData(db, user.id, today, tz),
  ])

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
