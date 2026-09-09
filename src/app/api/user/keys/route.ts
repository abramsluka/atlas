import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserApiKey, setUserApiKey, deleteUserApiKey, PROVIDER_LABEL, type KeyProvider } from '@/lib/userKeys'

// BYO API keys (multi-user): each user stores their own Anthropic/OpenAI key.
// The plaintext key is never returned to the client — only set/last4.

function parseProvider(value: unknown): KeyProvider | null {
  return value === 'anthropic' || value === 'openai' || value === 'gemini' ? value : null
}

async function authedUser() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

export async function GET() {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [anthropic, openai, gemini] = await Promise.all([
    getUserApiKey(user.id, 'anthropic'),
    getUserApiKey(user.id, 'openai'),
    getUserApiKey(user.id, 'gemini'),
  ])
  const summarize = (key: string | null) => ({ set: !!key, last4: key ? key.slice(-4) : null })
  return NextResponse.json({
    anthropic: summarize(anthropic),
    openai: summarize(openai),
    gemini: summarize(gemini),
  })
}

// Live-check the key against the provider so a bad key fails at save time, not
// silently at the first coach call. Returns null when the key is usable, or the
// message to show when it is not. A network hiccup returns null — a blip
// shouldn't lock someone out of saving a valid key.
//
// This checks USABILITY, not just authentication. An Anthropic key that isn't
// scoped to a workspace authenticates fine and then 400s on every real call,
// which is exactly how a user ends up with a green checkmark in Settings and
// "Mentor hit an error" everywhere else.
async function keyRejectionReason(provider: KeyProvider, key: string): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(5000)
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal,
      })
      if (res.status === 401 || res.status === 403) return AUTH_REJECTED
      if (res.status === 400) {
        const body = await res.json().catch(() => null)
        const msg = String(body?.error?.message ?? '')
        if (/not scoped to a workspace/i.test(msg)) {
          return 'That Anthropic key is not tied to a workspace, so Anthropic rejects every request made with it. In the Anthropic console go to API keys, create a new key, and pick a Workspace (not the organization) when it asks.'
        }
        return `Anthropic rejected this key: ${msg || 'unusable key'}`
      }
      return null
    }
    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal,
      })
      return res.status === 401 || res.status === 403 ? AUTH_REJECTED : null
    }
    // Google passes the key as a query param, and returns 400 (not 401) for a
    // malformed key, so treat that as a rejection too.
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      { signal }
    )
    return res.status === 400 || res.status === 401 || res.status === 403 ? AUTH_REJECTED : null
  } catch {
    return null
  }
}

const AUTH_REJECTED = 'The provider rejected this key — double-check it and try again'

export async function PUT(req: NextRequest) {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const provider = parseProvider(body?.provider)
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!provider || !key) {
    return NextResponse.json({ error: 'provider and key are required' }, { status: 400 })
  }

  const PREFIX: Record<KeyProvider, string> = {
    anthropic: 'sk-ant-',
    openai: 'sk-',
    gemini: 'AIza', // Google AI Studio keys
  }
  const expectedPrefix = PREFIX[provider]
  if (!key.startsWith(expectedPrefix) || key.length < 20) {
    return NextResponse.json(
      { error: `That doesn't look like a ${PROVIDER_LABEL[provider]} key (expected ${expectedPrefix}…)` },
      { status: 400 }
    )
  }

  const rejection = await keyRejectionReason(provider, key)
  if (rejection) return NextResponse.json({ error: rejection }, { status: 400 })

  await setUserApiKey(user.id, provider, key)
  return NextResponse.json({ ok: true, last4: key.slice(-4) })
}

export async function DELETE(req: NextRequest) {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const provider = parseProvider(body?.provider)
  if (!provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 })

  await deleteUserApiKey(user.id, provider)
  return NextResponse.json({ ok: true })
}
