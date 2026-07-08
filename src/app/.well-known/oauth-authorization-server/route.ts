import { CORS_HEADERS, authorizationServerMetadata } from '@/lib/oauth'

// RFC 8414 — Atlas is its own (single-user) authorization server.
export function GET() {
  return Response.json(authorizationServerMetadata(), { headers: CORS_HEADERS })
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}
