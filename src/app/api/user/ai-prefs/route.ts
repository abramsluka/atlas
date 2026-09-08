export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getUserProviders } from '@/lib/userKeys'
import { CATEGORY_PROVIDERS, type AiCategory } from '@/lib/aiProvider'

// Per-category AI provider preference (MULTI_PROVIDER_AI_SPEC.md).
// GET returns the saved prefs, which providers the user holds keys for, and
// which providers each category can legally use (voice can never be Anthropic).

function parseCategory(v: unknown): AiCategory | null {
  return v === 'coaching' || v === 'analysis' || v === 'voice' ? v : null
}

async function authedUser() {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  return user
}

export async function GET() {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceClient()
  const [{ data }, owned] = await Promise.all([
    db.from('user_settings').select('ai_prefs').eq('user_id', user.id).maybeSingle(),
    getUserProviders(user.id),
  ])

  return NextResponse.json({
    prefs: data?.ai_prefs ?? {},
    owned,
    allowed: CATEGORY_PROVIDERS,
  })
}

export async function PUT(req: NextRequest) {
  const user = await authedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const category = parseCategory(body?.category)
  const provider = body?.provider

  if (!category) return NextResponse.json({ error: 'valid category required' }, { status: 400 })
  if (!CATEGORY_PROVIDERS[category].includes(provider)) {
    return NextResponse.json(
      { error: `${provider} can't be used for ${category}.` },
      { status: 400 }
    )
  }

  // Don't let someone select a provider they have no key for — it would just
  // produce a 428 on the next request with no explanation.
  const owned = await getUserProviders(user.id)
  if (!owned.includes(provider)) {
    return NextResponse.json(
      { error: `Add your ${provider} key first.`, code: 'no_key_for_provider', provider },
      { status: 400 }
    )
  }

  const db = createServiceClient()
  const { data: existing } = await db
    .from('user_settings')
    .select('ai_prefs')
    .eq('user_id', user.id)
    .maybeSingle()

  const prefs = { ...((existing?.ai_prefs ?? {}) as Record<string, string>), [category]: provider }
  const { error } = await db
    .from('user_settings')
    .upsert({ user_id: user.id, ai_prefs: prefs }, { onConflict: 'user_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, prefs })
}
