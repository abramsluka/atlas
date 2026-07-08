import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { checkClientAndRedirect, OAUTH_SCOPE } from '@/lib/oauth'

export const dynamic = 'force-dynamic'

// OAuth consent screen. Session-cookie authed (the proxy bounces logged-out
// visitors to /login?next=…). Approve/Deny is a plain form POST to
// /api/oauth/authorize, which re-validates everything before minting a code.

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function ErrorCard({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Atlas</h1>
        <p className="mb-8 text-zinc-400 text-sm">Connection request</p>
        <div className="rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-400">
          {reason} The requesting app may be misconfigured — nothing was authorized.
        </div>
      </div>
    </div>
  )
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const clientId = str(params.client_id)
  const redirectUri = str(params.redirect_uri)
  const responseType = str(params.response_type)
  const codeChallenge = str(params.code_challenge)
  const codeChallengeMethod = str(params.code_challenge_method)
  const state = str(params.state)
  const scope = str(params.scope)

  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) {
    const query = new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : []))
    ).toString()
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${query}`)}`)
  }

  const db = createServiceClient()
  const check = await checkClientAndRedirect(db, clientId, redirectUri)
  if (!check.ok) return <ErrorCard reason={check.reason} />
  if (responseType !== 'code') return <ErrorCard reason="response_type must be 'code'." />
  if (!codeChallenge || codeChallengeMethod !== 'S256') {
    return <ErrorCard reason="PKCE (S256 code_challenge) is required." />
  }

  const clientName = check.client.client_name ?? 'An MCP client'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Atlas</h1>
        <p className="mb-8 text-zinc-400 text-sm">Connection request</p>

        <div className="rounded-2xl bg-zinc-900 p-5">
          <p className="text-base text-white">
            <span className="font-semibold">{clientName}</span> wants to connect to your Atlas.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            It will be able to log food, water, weight, caffeine, supplements, gym sets, jots and
            journal entries, and read your daily summary, food and gym history and recent journal.
          </p>

          <form method="POST" action="/api/oauth/authorize" className="mt-6 flex flex-col gap-3">
            <input type="hidden" name="client_id" value={clientId} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="code_challenge" value={codeChallenge} />
            {state != null && <input type="hidden" name="state" value={state} />}
            <input type="hidden" name="scope" value={scope ?? OAUTH_SCOPE} />
            <button
              type="submit"
              name="decision"
              value="approve"
              className="h-14 rounded-xl bg-white text-base font-semibold text-black active:opacity-80"
            >
              Approve
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="h-14 rounded-xl bg-zinc-800 text-base font-semibold text-zinc-300 active:opacity-80"
            >
              Deny
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
