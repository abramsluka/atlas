import { CORS_HEADERS, protectedResourceMetadata } from '@/lib/oauth'

// RFC 9728 — pointed to by the WWW-Authenticate header on /api/mcp 401s.
export function GET() {
  return Response.json(protectedResourceMetadata(), { headers: CORS_HEADERS })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
