import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserApiKey, setUserApiKey, deleteUserApiKey, type KeyProvider } from '@/lib/userKeys'

// BYO API keys (multi-user): each user stores their own Anthropic/OpenAI key.
// The plaintext key is never returned to the client — only set/last4.

function parseProvider(value: unknown): KeyProvider | null {
  return value === 'anthropic' || value === 'openai' ? value : null
}

async function authedUser() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

export async function GET() {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [anthropic, openai] = await Promise.all([
    getUserApiKey(user.id, 'anthropic'),
    getUserApiKey(user.id, 'openai'),
  ])
  const summarize = (key: string | null) => ({ set: !!key, last4: key ? key.slice(-4) : null })
  return NextResponse.json({ anthropic: summarize(anthropic), openai: summarize(openai) })
}

// Live-check the key against the provider so a typo'd key fails at save time,
// not silently at first coach call. Only an explicit auth rejection blocks the
// save — network hiccups shouldn't lock users out of storing a valid key.
async function keyIsRejected(provider: KeyProvider, key: string): Promise<boolean> {
  try {
    const res =
      provider === 'anthropic'
        ? await fetch('https://api.anthropic.com/v1/models?limit=1', {
            headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
            signal: AbortSignal.timeout(5000),
          })
        : await fetch('https://api.openai.com/v1/models', {
            headers: { Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(5000),
          })
    return res.status === 401 || res.status === 403
  } catch {
    return false
  }
}

export async function PUT(req: NextRequest) {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const provider = parseProvider(body?.provider)
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!provider || !key) {
    return NextResponse.json({ error: 'provider and key are required' }, { status: 400 })
  }

  const expectedPrefix = provider === 'anthropic' ? 'sk-ant-' : 'sk-'
  if (!key.startsWith(expectedPrefix) || key.length < 20) {
    return NextResponse.json(
      { error: `That doesn't look like ${provider === 'anthropic' ? 'an Anthropic' : 'an OpenAI'} key (expected ${expectedPrefix}…)` },
      { status: 400 }
    )
  }

  if (await keyIsRejected(provider, key)) {
    return NextResponse.json({ error: 'The provider rejected this key — double-check it and try again' }, { status: 400 })
  }

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
