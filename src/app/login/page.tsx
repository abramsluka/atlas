'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      // Honor a same-origin, path-only ?next= (set by the proxy for the OAuth
      // consent page). Anything absolute or protocol-relative falls back to /.
      const next = new URLSearchParams(window.location.search).get('next')
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/')
    }
  }

  const notInvited =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') === 'not-invited'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-3xl font-bold tracking-tight">Atlas</h1>
        <p className="mb-8 text-zinc-400 text-sm">Private beta</p>

        {notInvited && (
          <div className="mb-6 rounded-xl bg-red-900/30 px-4 py-3 text-sm text-red-400">
            Your email is not on the invite list.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="h-14 rounded-xl bg-zinc-900 px-4 text-base text-white placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-white/20"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            required
            autoComplete="current-password"
            className="h-14 rounded-xl bg-zinc-900 px-4 text-base text-white placeholder:text-zinc-600 outline-none focus:ring-2 focus:ring-white/20"
          />

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-14 rounded-xl bg-white text-base font-semibold text-black disabled:opacity-50 active:opacity-80"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
