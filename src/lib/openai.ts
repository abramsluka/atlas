import OpenAI from 'openai'
import { getUserApiKey } from '@/lib/userKeys'

// Per-user OpenAI client (BYO key) — powers food AI + voice transcription.
// Returns null when the user hasn't added a key; routes respond with
// noKeyResponse('openai') in that case.
export async function getOpenAIForUser(userId: string): Promise<OpenAI | null> {
  const key = await getUserApiKey(userId, 'openai')
  return key ? new OpenAI({ apiKey: key }) : null
}
