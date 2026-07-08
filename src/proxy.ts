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

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Endpoints authed by a long-lived sync token (the iOS Shortcut has no session
  // cookie) — they enforce their own Bearer auth, so skip the login redirect.
  const TOKEN_AUTHED_PATHS = ['/api/health/apple/sync', '/api/health/apple/export']
  // Public surfaces that must never bounce to /login: the MCP endpoint does its
  // own Bearer auth (and must 401, not 307), OAuth + discovery are pre-auth.
  const PUBLIC_PREFIXES = ['/api/mcp', '/api/oauth', '/.well-known']

  if (
    !user &&
    pathname !== '/login' &&
    !pathname.startsWith('/auth/') &&
    !TOKEN_AUTHED_PATHS.includes(pathname) &&
    !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon-.*\\.png|textures/).*)',
  ],
}
