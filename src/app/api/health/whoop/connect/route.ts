import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: `${req.nextUrl.origin}/api/health/whoop/callback`,
    scope: 'read:recovery read:sleep read:workout read:body_measurement offline',
  })

  return NextResponse.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`)
}
