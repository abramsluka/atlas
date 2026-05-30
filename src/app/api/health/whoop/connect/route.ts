import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export async function GET(req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', req.url))

  const state = randomBytes(16).toString('hex')

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WHOOP_CLIENT_ID!,
    redirect_uri: 'https://atlas-phi-plum.vercel.app/api/health/whoop/callback',
    scope: 'read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement',
    state,
  })

  const res = NextResponse.redirect(`https://api.prod.whoop.com/oauth/oauth2/auth?${params}`)
  res.cookies.set('whoop_state', state, { httpOnly: true, secure: true, maxAge: 600, path: '/' })
  return res
}
