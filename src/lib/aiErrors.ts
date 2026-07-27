import { NextResponse } from 'next/server'

// Shown when an AI call is blocked by a usage/spend cap or rate limit rather
// than a bug. Used for BYO-key users whose key sits in a spend-limited
// Anthropic/OpenAI workspace: when that workspace hits its monthly cap, calls
// fail here instead of returning a result.
export const AI_LIMIT_MESSAGE =
  'The AI usage limit for this account has been reached. Try again later.'

// True when an Anthropic/OpenAI SDK error looks like a rate-limit, spend-cap, or
// billing/quota block (not a bug or a transient network error). A monthly spend
// cap and a short-term rate limit can't always be told apart from the error
// alone, so AI_LIMIT_MESSAGE deliberately covers both ("try again later").
export function isAiLimitError(err: unknown): boolean {
  const e = err as {
    status?: number
    error?: { type?: string; message?: string }
    type?: string
    message?: string
  } | null
  if (!e || typeof e !== 'object') return false
  const status = e.status
  const type = e.error?.type ?? e.type
  const text = `${e.error?.message ?? ''} ${e.message ?? ''}`.toLowerCase()
  if (type === 'rate_limit_error' || type === 'billing_error') return true
  if (status === 429) return true
  if (
    (status === 400 || status === 403) &&
    /(credit balance|billing|quota|spend limit|usage limit|insufficient)/.test(text)
  ) {
    return true
  }
  return false
}

// Non-streaming counterpart to noKeyResponse(): a 428/429-style structured
// signal the frontend maps to AI_LIMIT_MESSAGE. 429 so it reads as "too much,
// back off" rather than a hard failure.
export function aiLimitResponse(): NextResponse {
  return NextResponse.json({ code: 'ai_limit', error: AI_LIMIT_MESSAGE }, { status: 429 })
}
