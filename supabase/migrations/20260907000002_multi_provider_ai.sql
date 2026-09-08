-- Multi-provider AI (Phase 1 of MULTI_PROVIDER_AI_SPEC.md).
--
-- Gemini joins Anthropic + OpenAI as a BYO key provider. The headline win is
-- onboarding: Gemini has a free tier, so a new user no longer needs a credit
-- card and prepaid Anthropic credits to use any AI feature at all.
alter table user_secrets add column if not exists gemini_api_key_enc text;

-- Per-category provider preference, e.g. {"coaching":"gemini"}.
-- Null/absent falls back to defaults resolved in src/lib/aiProvider.ts.
alter table user_settings add column if not exists ai_prefs jsonb;
