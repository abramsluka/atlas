import Anthropic from '@anthropic-ai/sdk'
import { getUserApiKey } from '@/lib/userKeys'

// Every Claude call is billed to the signed-in user's own key (BYO key,
// user_secrets table). Returns null when the user hasn't added one — routes
// respond with noKeyResponse('anthropic') in that case.
export async function getAnthropicForUser(userId: string): Promise<Anthropic | null> {
  const key = await getUserApiKey(userId, 'anthropic')
  return key ? new Anthropic({ apiKey: key }) : null
}
