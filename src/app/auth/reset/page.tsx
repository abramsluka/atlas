'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

// Where a password-recovery link lands. By the time the visitor gets here,
// /auth/callback has already exchanged the recovery code for a session, so they
// are signed in and updateUser() can set the new password directly.
//
// Recovery links are minted by scripts/reset-link.mjs and handed over directly
// (text/DM). Nothing here depends on an email being delivered.
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const supabase = createClient()
    const { error: updErr } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updErr) {
      setError(
        /session|jwt|token/i.test(updErr.message)
          ? 'This reset link has expired. Ask Luka for a new one.'
          : updErr.message
      )
      return
    }
    setDone(true)
    setTimeout(() => { router.push('/'); router.refresh() }, 1200)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-bold tracking-tight text-white">Set a new password</h1>
        <p className="mb-6 text-sm text-zinc-400">Pick something you&apos;ll remember.</p>

        {done ? (
          <div className="rounded-xl bg-green-900/25 px-4 py-3 text-sm text-green-400">
            Password updated. Taking you to Atlas…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null) }}
              placeholder="New password (8+ characters)"
              required
              minLength={8}
              autoComplete="new-password"
              className="rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[15px] text-white placeholder:text-zinc-600 focus:border-white/25 focus:outline-none"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null) }}
              placeholder="Confirm new password"
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
              {loading ? 'Saving…' : 'Save password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
