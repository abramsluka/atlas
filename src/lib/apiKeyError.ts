// Client-side counterpart to noKeyResponse() (src/lib/userKeys.ts). AI routes
// return 428 { code: 'no_api_key', provider } when the user hasn't added a
// key yet — this turns that into a typed error so callers can show
// "Add your key in Settings" instead of a generic failure message.

export type KeyProvider = 'anthropic' | 'openai'

export class NoApiKeyClientError extends Error {
  provider: KeyProvider
  constructor(provider: KeyProvider) {
    super(noApiKeyMessage(provider))
    this.name = 'NoApiKeyClientError'
    this.provider = provider
  }
}

export function noApiKeyMessage(provider: KeyProvider): string {
  const name = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
  return `Add your ${name} key in Settings to use this feature.`
}

// Call after `!res.ok`. Returns a NoApiKeyClientError for the 428 case,
// otherwise null so the caller falls back to its normal error handling.
export async function checkNoApiKey(res: Response): Promise<NoApiKeyClientError | null> {
  if (res.status !== 428) return null
  const body = await res.json().catch(() => null) as { code?: string; provider?: KeyProvider } | null
  if (body?.code !== 'no_api_key' || !body.provider) return null
  return new NoApiKeyClientError(body.provider)
}
