import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncOuraToday } from '@/features/health/ouraSync'
import { syncWhoopToday } from '@/features/health/whoopSync'
import { syncFitbitToday } from '@/features/health/fitbitSync'
import { getActiveWearableProvider } from '@/features/health/wearableProvider'
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

  // Syncs whichever wearable is the user's main one; both return the same
  // OuraData shape so the client query key stays ['health', 'oura', today].
  const provider = await getActiveWearableProvider(db, user.id)
  const data = provider === 'fitbit'
    ? await syncFitbitToday(db, user.id, today, tz, force)
    : provider === 'whoop'
      ? await syncWhoopToday(db, user.id, today, force)
      : await syncOuraToday(db, user.id, today, force)
  return NextResponse.json(data)
}
