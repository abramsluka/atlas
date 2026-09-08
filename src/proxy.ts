import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims verifies the session JWT locally (ES256 + cached JWKS) — no
  // Supabase round-trip on the hot path, unlike getUser which is a network
  // call on EVERY request. An expired token still refreshes: getClaims goes
  // through getSession first, which rotates cookies via setAll above.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims ?? null

  const { pathname } = request.nextUrl

  // Endpoints authed by a long-lived sync token (the iOS Shortcut has no session
  // cookie) — they enforce their own Bearer auth, so skip the login redirect.
  const TOKEN_AUTHED_PATHS = ['/api/health/apple/sync', '/api/health/apple/export']
  // Public surfaces that must never bounce to /login: the MCP endpoint does its
  // own Bearer auth (and must 401, not 307), OAuth + discovery are pre-auth,
  // /demo/<token> is the shareable demo auto-login (it checks its own secret).
  // /join is the invite signup (it checks its own token); /api/join is its POST.
  // /guide is the API-key walkthrough, linked from invites and read before signup.
  // /privacy is linked from the Google OAuth consent screen, so it must be readable
  // by a logged-out visitor (and by Google's own checks).
  const PUBLIC_PREFIXES = ['/api/mcp', '/api/oauth', '/.well-known', '/demo', '/join', '/api/join', '/guide', '/privacy']

  if (
    !user &&
    pathname !== '/login' &&
    !pathname.startsWith('/auth/') &&
    !TOKEN_AUTHED_PATHS.includes(pathname) &&
    !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // OAuth consent must survive the login bounce: carry the original URL so
    // the login page can return there after sign-in. Only for /oauth/authorize.
    if (pathname === '/oauth/authorize') {
      url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`
    }
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // emoji-data.json is a static asset fetched by <emoji-picker>; routing it
    // through the session refresh means a stale cookie 307s it to the login
    // HTML and the picker silently falls back to its text input.
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|emoji-data.json|icon-.*\\.png|textures/).*)',
  ],
}
