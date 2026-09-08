import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { decryptSecret, encryptSecret } from '@/lib/secretCrypto'

// Per-user BYO API keys (multi-user model: every user brings their own
// Anthropic/OpenAI key; there is no global fallback). Stored encrypted in
// user_secrets — RLS with no policies, service client only.

export type KeyProvider = 'anthropic' | 'openai' | 'gemini'

export const PROVIDER_LABEL: Record<KeyProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
}

// Thrown by helpers that can't proceed without a key (e.g. transcription deep
// inside a route). Route catch blocks map it to noKeyResponse(err.provider).
export class NoApiKeyError extends Error {
  provider: KeyProvider
  constructor(provider: KeyProvider) {
    super(`No ${provider} API key configured`)
    this.name = 'NoApiKeyError'
    this.provider = provider
  }
}

export async function requireUserApiKey(userId: string, provider: KeyProvider): Promise<string> {
  const key = await getUserApiKey(userId, provider)
  if (!key) throw new NoApiKeyError(provider)
  return key
}

const COLUMN: Record<KeyProvider, string> = {
  anthropic: 'anthropic_api_key_enc',
  openai: 'openai_api_key_enc',
  gemini: 'gemini_api_key_enc',
}

// Which providers this user actually has a key for. Used to gate the provider
// pickers in Settings and to build a useful "no key" error.
export async function getUserProviders(userId: string): Promise<KeyProvider[]> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_secrets')
    .select('anthropic_api_key_enc, openai_api_key_enc, gemini_api_key_enc')
    .eq('user_id', userId)
    .maybeSingle()
  if (!data) return []
  const row = data as Record<string, string | null>
  return (Object.keys(COLUMN) as KeyProvider[]).filter((p) => !!row[COLUMN[p]])
}

export async function getUserApiKey(userId: string, provider: KeyProvider): Promise<string | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_secrets')
    .select(COLUMN[provider])
    .eq('user_id', userId)
    .maybeSingle()
  const enc = (data as Record<string, string | null> | null)?.[COLUMN[provider]]
  if (!enc) return null
  try {
    return decryptSecret(enc)
  } catch (err) {
    console.error(`[userKeys] failed to decrypt ${provider} key for user ${userId}:`, err)
    return null
  }
}

export async function setUserApiKey(userId: string, provider: KeyProvider, key: string): Promise<void> {
  const db = createServiceClient()
  const { error } = await db.from('user_secrets').upsert(
    { user_id: userId, [COLUMN[provider]]: encryptSecret(key), updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  )
  if (error) throw new Error(`Failed to save ${provider} key: ${error.message}`)
}

export async function deleteUserApiKey(userId: string, provider: KeyProvider): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('user_secrets')
    .update({ [COLUMN[provider]]: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to remove ${provider} key: ${error.message}`)
}

// Consistent "no key configured" response for AI routes. 428 so clients can
// distinguish it from real failures and point the user at Settings.
export function noKeyResponse(provider: KeyProvider): NextResponse {
  return NextResponse.json(
    {
      code: 'no_api_key',
      provider,
      error: `Add your ${PROVIDER_LABEL[provider]} API key in Settings to use this feature.`,
    },
    { status: 428 }
  )
}
