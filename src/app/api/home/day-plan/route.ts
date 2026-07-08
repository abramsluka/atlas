import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserTimezone } from '@/lib/getUserTimezone'
import { toLocalDate } from '@/lib/date'

// Fallback source for the Home Day Plan card when the server seed is missing.
export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const tz = await getUserTimezone(user.id)
  const today = toLocalDate(tz)

  const { data, error } = await db
    .from('journal_entries')
    .select('id, plan')
    .eq('user_id', user.id)
    .eq('date', today)
    .eq('kind', 'morning')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ entryId: null, plan: [] })
  return NextResponse.json({ entryId: data.id, plan: data.plan ?? [] })
}
