import { createServiceClient } from '@/lib/supabase/server'

export async function getUserTimezone(userId: string): Promise<string> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_settings')
    .select('timezone')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.timezone ?? 'UTC'
}
