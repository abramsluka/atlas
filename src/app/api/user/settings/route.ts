import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { normalizeClock } from '@/lib/schedule'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const { data } = await db
    .from('user_settings')
    .select('timezone, wake_time, sleep_time')
    .eq('user_id', user.id)
    .maybeSingle()

  return NextResponse.json({
    timezone: data?.timezone ?? null,
    wake_time: normalizeClock(data?.wake_time),
    sleep_time: normalizeClock(data?.sleep_time),
  })
}

// Partial upsert: only the keys present in the body are written. TabBar/Home
// post just { timezone } on every visit; Settings posts wake_time/sleep_time
// ('HH:MM', or null to clear).
export async function POST(req: Request) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const patch: Record<string, string | null> = {}

  if ('timezone' in body) {
    if (!body.timezone || typeof body.timezone !== 'string') {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
    patch.timezone = body.timezone
  }
  for (const key of ['wake_time', 'sleep_time'] as const) {
    if (!(key in body)) continue
    if (body[key] === null || body[key] === '') { patch[key] = null; continue }
    const clock = normalizeClock(body[key])
    if (!clock) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
    patch[key] = clock
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db.from('user_settings').upsert(
    { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
