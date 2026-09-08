'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function JoinClient({ token, valid, demoHref }: {
  token: string
  valid: boolean
  demoHref: string | null
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!valid) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-white">Atlas</h1>
          <p className="text-sm text-zinc-400">
            This invite link isn&apos;t valid or has been retired. Ask Luka for a fresh one.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/join/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, email, password }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not create your account.')
        setLoading(false)
        return
      }
      if (json.signedIn) {
        router.push('/onboarding')
        router.refresh()
      } else {
        router.push('/login')
      }
    } catch {
      setError('Network error. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold tracking-tight text-white">Atlas</h1>
        <p className="mb-6 text-sm leading-relaxed text-zinc-400">
          A personal life OS — training, food, sleep, habits and journaling in one place, with an
          AI coach that reads all of it. You&apos;ve been invited.
        </p>

        {!showForm ? (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => setShowForm(true)}
              className="w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a]"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              Create your account
            </button>
            {demoHref && (
              <a
                href={demoHref}
                className="w-full rounded-xl border border-white/12 bg-white/[0.03] py-3 text-center text-[13.5px] font-semibold text-white/70 active:opacity-70"
              >
                Take a look at a live demo first
              </a>
            )}
            <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-600">
              Atlas runs its AI on your own API key, billed to your own account. Setup takes a
              couple of minutes and we walk you through it.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); setError(null) }}
              placeholder="First name"
              required
              autoComplete="given-name"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(null) }}
              placeholder="you@example.com"
              required
              autoComplete="email"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              placeholder="Password (8+ characters)"
              required
              minLength={8}
              autoComplete="new-password"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null) }}
              placeholder="Confirm password"
              required
              autoComplete="new-password"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />

            {error && <p className="text-[12px] text-red-400/90">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {loading ? 'Creating your account…' : 'Create account'}
            </button>
            <p className="text-center text-[11.5px] text-zinc-600">
              Already have an account?{' '}
              <a href="/login" className="text-zinc-400 underline">Sign in</a>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
