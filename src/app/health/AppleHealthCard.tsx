'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const h = Math.floor(mins / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="mt-1.5">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">{label}</p>
      <button
        onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
        className="w-full flex items-center gap-2 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-left">
        <span className="flex-1 text-[11px] font-mono text-zinc-300 truncate">{value}</span>
        <span className="text-[10px] font-semibold shrink-0" style={{ color: copied ? '#4ade80' : '#71717a' }}>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  )
}

// Setup-only panel (lives inside the Health settings sheet). No data display —
// synced steps and workouts feed Atlas in the background.
export default function AppleHealthCard() {
  const qc = useQueryClient()
  const [showGuide, setShowGuide] = useState(false)

  const { data: status } = useQuery<{ lastSync: string | null; daysOfData: number }>({
    queryKey: ['apple-health-status'],
    queryFn: async () => (await fetch('/api/health/apple/status')).json(),
    staleTime: 30_000,
  })
  const { data: tokenData } = useQuery<{ token: string | null }>({
    queryKey: ['sync-token'],
    queryFn: async () => (await fetch('/api/user/api-token')).json(),
    staleTime: 60_000,
  })

  const genToken = useMutation({
    mutationFn: async () => (await fetch('/api/user/api-token', { method: 'POST' })).json(),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sync-token'] }); setShowGuide(true) },
  })

  const token = tokenData?.token ?? null
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const syncUrl = `${origin}/api/health/apple/sync`
  const exportUrl = `${origin}/api/health/apple/export`
  const connected = !!token && (status?.daysOfData ?? 0) > 0

  if (!token) {
    return (
      <div>
        <p className="text-[11.5px] text-zinc-500 leading-relaxed mb-2.5">
          Pulls steps, cardio, and VO₂ max from your iPhone in the background (feeds your coach &amp; insights), and writes weight + nutrition back out. Built with an iOS Shortcut.
        </p>
        <button
          onClick={() => genToken.mutate()}
          disabled={genToken.isPending}
          className="text-xs font-semibold text-white/60 hover:text-white/80 underline disabled:opacity-50">
          {genToken.isPending ? 'Setting up…' : 'Set up Apple Health sync'}
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-[11.5px] text-zinc-500">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: connected ? '#4ade80' : '#71717a' }} />
        {connected && status?.lastSync ? `Synced ${relTime(status.lastSync)}` : 'Token ready — run the Shortcut'}
        <button onClick={() => setShowGuide(s => !s)} className="ml-auto text-white/40 hover:text-white/60 underline">
          {showGuide ? 'Hide' : 'Setup guide'}
        </button>
      </div>

      {showGuide && (
        <div className="mt-2.5">
          <CopyRow label="Sync token (Bearer)" value={token} />
          <CopyRow label="Sync-in URL (POST)" value={syncUrl} />
          <CopyRow label="Write-back URL (GET)" value={exportUrl} />

          <div className="mt-2.5 text-[11px] text-zinc-500 leading-relaxed space-y-2">
            <p><span className="font-semibold text-zinc-300">Shortcut 1 — Sync in:</span> Find Health Samples for Steps + Active Energy (Today) → POST to the Sync-in URL, header <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>, JSON body <span className="font-mono">{'{steps, active_calories}'}</span>. Run on your iPhone (not Mac); automate at 8am.</p>
            <p><span className="font-semibold text-zinc-300">Shortcut 2 — Write back:</span> GET the Write-back URL (same header) → log <span className="font-mono">body_weight.value</span> as Body Mass, <span className="font-mono">nutrition.calories</span>/<span className="font-mono">protein_g</span> as Dietary Energy/Protein.</p>
          </div>

          <button onClick={() => genToken.mutate()} disabled={genToken.isPending}
            className="mt-2.5 text-[11px] font-semibold text-amber-400/70 active:opacity-60">
            {genToken.isPending ? 'Regenerating…' : 'Regenerate token'}
          </button>
        </div>
      )}
    </div>
  )
}
