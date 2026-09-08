import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { createServiceClient } from '@/lib/supabase/server'
import { getUserApiKey, getUserProviders, type KeyProvider } from '@/lib/userKeys'

// Per-category AI provider routing (MULTI_PROVIDER_AI_SPEC.md, Phase 1).
//
// Users pick a PROVIDER per category; Atlas picks the model. Exposing raw model
// IDs invites people to select something that can't do the job and then report
// a bug.
//
// Phase 1 wires the 'coaching' category only. 'analysis' (vision) and 'voice'
// (transcription) still run on their existing hard-coded paths until Phases 2
// and 3. Note 'voice' can never offer Anthropic — there is no Claude audio API.

export type AiCategory = 'coaching' | 'analysis' | 'voice'

export const CATEGORY_PROVIDERS: Record<AiCategory, KeyProvider[]> = {
  coaching: ['anthropic', 'openai', 'gemini'],
  analysis: ['anthropic', 'openai', 'gemini'],
  voice: ['openai', 'gemini'], // Claude has no transcription API, ever
}

const CATEGORY_DEFAULT: Record<AiCategory, KeyProvider> = {
  coaching: 'anthropic',
  analysis: 'openai',
  voice: 'openai',
}

// One place to bump model IDs. `strong` is user-facing work (coaching, chat),
// `fast` is cheap background work (titles, chips, one-line extractions).
const MODELS: Record<KeyProvider, { strong: string; fast: string }> = {
  anthropic: { strong: 'claude-sonnet-4-6', fast: 'claude-haiku-4-5' },
  openai: { strong: 'gpt-4o', fast: 'gpt-4o-mini' },
  gemini: { strong: 'gemini-2.0-flash', fast: 'gemini-2.0-flash-lite' },
}

export type ResolvedModel = {
  provider: KeyProvider
  modelId: string
  model: LanguageModel
}

function build(provider: KeyProvider, apiKey: string, tier: 'strong' | 'fast'): ResolvedModel {
  const modelId = MODELS[provider][tier]
  switch (provider) {
    case 'anthropic':
      return { provider, modelId, model: createAnthropic({ apiKey })(modelId) }
    case 'openai':
      return { provider, modelId, model: createOpenAI({ apiKey })(modelId) }
    case 'gemini':
      return { provider, modelId, model: createGoogleGenerativeAI({ apiKey })(modelId) }
  }
}

async function getPreference(userId: string, category: AiCategory): Promise<KeyProvider | null> {
  const db = createServiceClient()
  const { data } = await db
    .from('user_settings')
    .select('ai_prefs')
    .eq('user_id', userId)
    .maybeSingle()
  const prefs = (data?.ai_prefs ?? null) as Record<string, string> | null
  const picked = prefs?.[category]
  return picked && CATEGORY_PROVIDERS[category].includes(picked as KeyProvider)
    ? (picked as KeyProvider)
    : null
}

/**
 * Resolve the model for a category, honoring the user's preference and falling
 * back to any provider they actually hold a key for.
 *
 * Returns null when the user has no usable key for this category, so callers
 * keep the existing `428 no_api_key` contract.
 */
export async function getModelForFeature(
  userId: string,
  category: AiCategory,
  tier: 'strong' | 'fast' = 'strong'
): Promise<ResolvedModel | null> {
  const allowed = CATEGORY_PROVIDERS[category]
  const owned = (await getUserProviders(userId)).filter((p) => allowed.includes(p))
  if (owned.length === 0) return null

  // Preference first, then the category default, then whatever they have. This
  // is what lets a Gemini-only user work with no configuration at all.
  const preferred = await getPreference(userId, category)
  const chosen =
    (preferred && owned.includes(preferred) && preferred) ||
    (owned.includes(CATEGORY_DEFAULT[category]) && CATEGORY_DEFAULT[category]) ||
    owned[0]

  const apiKey = await getUserApiKey(userId, chosen)
  if (!apiKey) return null
  return build(chosen, apiKey, tier)
}

/** Which provider a "no key" error should name for this category. */
export function suggestedProviderFor(category: AiCategory): KeyProvider {
  return CATEGORY_DEFAULT[category]
}
