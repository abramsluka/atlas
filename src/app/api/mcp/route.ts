import { createMcpHandler, withMcpAuth } from 'mcp-handler'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { resolveMcpUser } from '@/lib/mcpAuth'
import { registerAtlasTools, ATLAS_INSTRUCTIONS } from '@/features/mcp/tools'

export const runtime = 'nodejs'
export const maxDuration = 60

// Streamable HTTP only (no SSE legacy transport, no Redis). basePath '/api'
// makes mcp-handler's exact-match endpoint `/api/mcp` — which is this file.
const handler = createMcpHandler(
  (server) => {
    registerAtlasTools(server)
  },
  {
    serverInfo: { name: 'atlas', version: '1.0.0' },
    instructions: ATLAS_INSTRUCTIONS,
  },
  {
    basePath: '/api',
    maxDuration: 60,
    disableSse: true,
  }
)

// Every request re-authenticates via the Bearer token — stateless, no sessions.
// resolveMcpUser is the entire security boundary; the resolved user_id rides on
// AuthInfo.extra into every tool handler.
const verifyToken = async (_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> => {
  if (!bearerToken) return undefined
  const userId = await resolveMcpUser(`Bearer ${bearerToken}`)
  if (!userId) return undefined
  return {
    token: bearerToken,
    clientId: 'atlas',
    scopes: ['atlas:full'],
    extra: { userId },
  }
}

// On missing/invalid token this responds 401 with
// WWW-Authenticate: Bearer ..., resource_metadata="<origin>/.well-known/oauth-protected-resource"
// — required even in Phase 2 so claude.ai starts the OAuth dance in Phase 3.
const authHandler = withMcpAuth(handler, verifyToken, { required: true })

export { authHandler as GET, authHandler as POST, authHandler as DELETE }
