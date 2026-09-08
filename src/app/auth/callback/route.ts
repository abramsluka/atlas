import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: allowed } = await supabase
    .from('allowed_emails')
    .select('email')
    .eq('email', data.user.email)
    .maybeSingle()

  if (!allowed) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=not-invited', request.url))
  }

  // Honor a same-origin, path-only ?next= so the password-recovery link can land
  // on /auth/reset instead of the dashboard. Anything absolute or
  // protocol-relative is ignored (open-redirect guard).
  const next = searchParams.get('next')
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
  return NextResponse.redirect(new URL(dest, request.url))
}
