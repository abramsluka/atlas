import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.OURA_CLIENT_ID!,
    redirect_uri: `${req.nextUrl.origin}/api/health/oura/callback`,
    scope: 'daily sleep readiness activity personal',
  })

  return NextResponse.redirect(`https://cloud.ouraring.com/oauth/authorize?${params}`)
}
