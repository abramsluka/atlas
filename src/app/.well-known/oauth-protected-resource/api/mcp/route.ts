import { CORS_HEADERS, protectedResourceMetadata } from '@/lib/oauth'

// Path-suffixed RFC 9728 variant (/.well-known/oauth-protected-resource/api/mcp)
// — Claude probes this one first for resources that live under a path.
export function GET() {
  return Response.json(protectedResourceMetadata(), { headers: CORS_HEADERS })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
