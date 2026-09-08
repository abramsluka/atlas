export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient } from '@/lib/supabase/server'

// Shareable demo auto-login: GET /demo/<token> signs the visitor into the demo
// account (server-side password sign-in → session cookies on the redirect) and
// lands them on the dashboard. The token in the URL is the whole secret —
// rotate DEMO_LOGIN_TOKEN to revoke every link ever handed out. /demo is in the
// proxy.ts bypass list; without that, logged-out visitors 307 to /login before
// ever reaching this handler.

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const expected = process.env.DEMO_LOGIN_TOKEN
  const email = process.env.DEMO_ACCOUNT_EMAIL
  const password = process.env.DEMO_ACCOUNT_PASSWORD

  if (!expected || !email || !password || !safeEqual(token, expected)) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    console.error('[demo] sign-in failed:', error.message)
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const res = NextResponse.redirect(new URL('/', request.url))

  // Arriving from an invite page (/join/<token> passes ?invite=…) means this
  // visitor still needs a way BACK to sign up — otherwise the demo is a
  // dead end they can only escape with the back button. Remember the invite so
  // the demo banner can offer "Create your account".
  const invite = request.nextUrl.searchParams.get('invite')
  if (invite && /^[A-Za-z0-9_-]{16,128}$/.test(invite)) {
    res.cookies.set('atlas-invite-return', invite, {
      maxAge: 60 * 60 * 6,
      sameSite: 'lax',
      path: '/',
    })
  }

  return res
}
