import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subDays } from 'date-fns'
import { getUserTimezone } from '@/lib/getUserTimezone'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const sevenDaysAgoISO = subDays(new Date(), 7).toISOString()

  const [gymLogsRes, journalRes, mentorRes] = await Promise.all([
    db.from('gym_logs').select('logged_at').eq('user_id', user.id).gte('logged_at', sevenDaysAgoISO),
    db.from('journal_entries').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', sevenDaysAgoISO),
    // Conversations touched this week — mentor_memories used to back this stat,
    // and this is closer to what it was trying to say anyway.
    db.from('mentor_conversations').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('updated_at', sevenDaysAgoISO),
  ])

  // Count distinct training days (a day with any gym sets = 1 session)
  const gymDays = new Set(
    (gymLogsRes.data ?? []).map(r =>
      new Date(r.logged_at).toLocaleDateString('en-CA', { timeZone: TZ })
    )
  )

  return NextResponse.json({
    gym: gymDays.size,
    health: 0,
    journal: journalRes.count ?? 0,
    mentor: mentorRes.count ?? 0,
  })
}
