import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { getUserTimezone } from '@/lib/getUserTimezone'

export const revalidate = 300 // 5-minute cache

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const TZ = await getUserTimezone(user.id)
  const sevenDaysAgo = formatInTimeZone(subDays(new Date(), 7), TZ, 'yyyy-MM-dd')
  const sevenDaysAgoISO = new Date(sevenDaysAgo).toISOString()

  const [gymRes, journalRes, mentorRes] = await Promise.all([
    db.from('workouts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).not('completed_at', 'is', null).gte('completed_at', sevenDaysAgoISO),
    db.from('journal_entries').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', sevenDaysAgoISO),
    db.from('mentor_memories').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', sevenDaysAgoISO),
  ])

  return NextResponse.json({
    gym: gymRes.count ?? 0,
    health: 0, // placeholder — no single health log table
    journal: journalRes.count ?? 0,
    mentor: mentorRes.count ?? 0,
  })
}
