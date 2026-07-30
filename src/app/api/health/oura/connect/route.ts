import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  // Oura v2 scope names are 'personal' and 'daily' (daily covers sleep,
  // readiness, and activity — those are NOT scopes themselves; requesting them
  // makes Oura issue a token with no scope claim that 401s on every endpoint).
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.OURA_CLIENT_ID!,
    redirect_uri: `${req.nextUrl.origin}/api/health/oura/callback`,
    scope: 'personal daily',
  })

  return NextResponse.redirect(`https://cloud.ouraring.com/oauth/authorize?${params}`)
}
