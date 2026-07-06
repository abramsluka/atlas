import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncOuraToday } from '@/features/health/ouraSync'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)
  const force = new URL(req.url).searchParams.get('force') === '1'

  const data = await syncOuraToday(db, user.id, today, force)
  return NextResponse.json(data)
}
