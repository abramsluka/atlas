'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/browser'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  const notInvited =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('error') === 'not-invited'

  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="mb-2 text-2xl font-bold tracking-tight">Check your email</h1>
          <p className="text-zinc-400">
            We sent a magic link to <span className="text-white">{email}</span>.
          </p>
        </div>
      </div>
    )
  }

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

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-14 rounded-xl bg-white text-base font-semibold text-black disabled:opacity-50 active:opacity-80"
          >
            {loading ? 'Sending…' : 'Send magic link'}
          </button>
        </form>
      </div>
    </div>
  )
}
