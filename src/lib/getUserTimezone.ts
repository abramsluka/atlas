import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export async function getUserTimezone(userId: string): Promise<string> {
  // Fast path: the device timezone cookie TabBar sets on every visit. Saves a
  // blocking DB round-trip on each page render, and the device tz is fresher
  // than user_settings anyway (it follows the user when they travel). Cookie
  // values are user-controlled, so validate before trusting; requests without
  // the cookie (first visit, MCP, iOS Shortcut) fall through to the DB.
  try {
    const tz = (await cookies()).get('atlas-tz')?.value
    if (tz && isValidTimezone(tz)) return tz
  } catch {
    // outside a request scope — fall through to the DB lookup
  }

  const db = createServiceClient()
  const { data } = await db
    .from('user_settings')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.timezone ?? 'UTC'
}
