export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Invite-link signup. The token in the URL is the whole gate — rotate
// INVITE_TOKEN to revoke every link ever handed out. Accounts are created
// already-confirmed (`email_confirm: true`) so NO confirmation email is ever
// sent: Supabase's built-in sender is rate-limited and spam-filed, and a signup
// that silently dies on email delivery is the failure mode to avoid.

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const expected = process.env.INVITE_TOKEN
    if (!expected || !safeEqual(token, expected)) {
      return NextResponse.json({ error: 'This invite link is not valid.' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : ''
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!firstName) {
      return NextResponse.json({ error: 'Enter your first name.' }, { status: 400 })
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    }

    const db = createServiceClient()

    // Global cap — the control that actually bounds a forwarded link, since the
    // per-IP limiter is per-instance on Vercel and evadable.
    const cap = Number(process.env.INVITE_MAX_SIGNUPS ?? 10)
    const { count } = await db.from('invite_signups').select('id', { count: 'exact', head: true })
    if ((count ?? 0) >= cap) {
      return NextResponse.json(
        { error: 'This invite link has reached its signup limit. Ask Luka for a new one.' },
        { status: 403 }
      )
    }

    const { data: created, error: createErr } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: firstName },
    })
    if (createErr || !created?.user) {
      const already = /already|registered|exists/i.test(createErr?.message ?? '')
      return NextResponse.json(
        {
          error: already
            ? 'That email already has an account. Try signing in instead.'
            : 'Could not create the account. Try again.',
        },
        { status: already ? 409 : 500 }
      )
    }
    const userId = created.user.id

    // The invite token is what earns the allowlist entry (/auth/callback gate).
    await db.from('allowed_emails').upsert({ email }, { onConflict: 'email' })
    // first_name drives the dashboard title. onboarding_completed_at is left
    // NULL on purpose so this user gets the wizard once it ships.
    await db.from('user_settings').upsert({ user_id: userId, first_name: firstName }, { onConflict: 'user_id' })
    await db.from('invite_signups').insert({ email, user_id: userId })

    // Sign them straight in. This also overwrites any demo-account session
    // cookie left behind if they took the demo peek on the landing page first.
    const authClient = await createClient()
    const { error: signInErr } = await authClient.auth.signInWithPassword({ email, password })
    if (signInErr) {
      console.error('[join] created but sign-in failed:', signInErr.message)
      return NextResponse.json({ ok: true, signedIn: false })
    }

    return NextResponse.json({ ok: true, signedIn: true })
  } catch (err) {
    console.error('[join] error:', err)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
