import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { GYM_PRESETS } from '@/data/gymPresets'

export async function GET() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(GYM_PRESETS)
}
