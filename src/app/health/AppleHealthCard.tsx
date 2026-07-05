'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface AppleStatus {
  daysOfData: number
  lastSync: string | null
  latest: { date: string; steps: number | null; active_calories: number | null; vo2_max: number | null } | null
  recentWorkouts: Array<{ workout_type: string | null; date: string | null; duration_min: number | null; distance_mi: number | null; active_calories: number | null }>
}

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

export default function AppleHealthCard() {
  const qc = useQueryClient()
  const [showGuide, setShowGuide] = useState(false)

  const { data: status } = useQuery<AppleStatus>({
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

  const latest = status?.latest
  const connected = !!token && (status?.daysOfData ?? 0) > 0

  return (
    <div className="bg-[#111113] border border-white/[0.06] rounded-[18px] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-zinc-500">Apple Health</p>
        {connected && (
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#4ade80' }} />
            {status?.lastSync ? `synced ${relTime(status.lastSync)}` : 'connected'}
          </span>
        )}
      </div>

      {!token ? (
        <>
          <p className="text-[11.5px] text-zinc-500 leading-relaxed mb-3">
            Bridge steps, cardio workouts, and VO₂ max in from your iPhone — and write your weight &amp; nutrition back out. Uses an iOS Shortcut, no App Store needed.
          </p>
          <button
            onClick={() => genToken.mutate()}
            disabled={genToken.isPending}
            className="w-full rounded-lg bg-white px-3 py-2 text-center text-xs font-semibold text-black disabled:opacity-50">
            {genToken.isPending ? 'Setting up…' : 'Set up Apple Health'}
          </button>
        </>
      ) : (
        <>
          {/* Incoming data */}
          {latest ? (
            <div className="grid grid-cols-3 gap-3 mb-1">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Steps</p>
                <p className="text-sm font-semibold text-white">{latest.steps != null ? latest.steps.toLocaleString() : '--'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Active</p>
                <p className="text-sm font-semibold text-white">{latest.active_calories != null ? `${latest.active_calories}` : '--'}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">VO₂ max</p>
                <p className="text-sm font-semibold text-white">{latest.vo2_max != null ? latest.vo2_max : '--'}</p>
              </div>
            </div>
          ) : (
            <p className="text-[11.5px] text-zinc-500 mb-2">Token ready — no data synced yet. Build the Shortcut below.</p>
          )}

          {status && status.recentWorkouts.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Recent cardio</p>
              {status.recentWorkouts.slice(0, 3).map((w, i) => (
                <div key={i} className="flex items-center justify-between text-[11.5px]">
                  <span className="text-zinc-300 capitalize">{w.workout_type ?? 'Workout'}</span>
                  <span className="text-zinc-500 tabular-nums">
                    {[w.duration_min != null ? `${Math.round(w.duration_min)}m` : null, w.distance_mi != null ? `${w.distance_mi.toFixed(1)}mi` : null, w.active_calories != null ? `${w.active_calories}cal` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button onClick={() => setShowGuide(s => !s)} className="mt-3 text-[11.5px] font-semibold text-zinc-400 active:opacity-60">
            {showGuide ? 'Hide setup' : 'Setup & Shortcut guide'}
          </button>

          {showGuide && (
            <div className="mt-3 pt-3 border-t border-white/[0.06]">
              <CopyRow label="Sync token (Bearer)" value={token} />
              <CopyRow label="Sync-in URL (POST)" value={syncUrl} />
              <CopyRow label="Write-back URL (GET)" value={exportUrl} />

              <div className="mt-3 text-[11.5px] text-zinc-400 leading-relaxed space-y-2.5">
                <div>
                  <p className="font-semibold text-zinc-300">Shortcut 1 — Sync in (run each morning)</p>
                  <p className="text-zinc-500">Find Health Samples for Steps + Active Energy (Today) and VO₂ Max (latest) → build a dictionary <span className="font-mono">{'{date, steps, active_calories, vo2_max, workouts}'}</span> → Get Contents of URL to the Sync-in URL, method POST, header <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>, body the dictionary. Add it as a Time-of-Day automation at 8am, “Ask Before Running” off.</p>
                </div>
                <div>
                  <p className="font-semibold text-zinc-300">Shortcut 2 — Write back (run each night)</p>
                  <p className="text-zinc-500">Get Contents of URL from the Write-back URL (GET, same Bearer header) → Get Dictionary Value <span className="font-mono">body_weight.value</span> → Log Health Sample “Body Mass”. Then log <span className="font-mono">nutrition.calories</span> as Dietary Energy and <span className="font-mono">nutrition.protein_g</span> as Protein. Automate nightly.</p>
                </div>
                <p className="text-zinc-600">The token authenticates the Shortcut — keep it private. Regenerating invalidates the old one.</p>
              </div>

              <button
                onClick={() => genToken.mutate()}
                disabled={genToken.isPending}
                className="mt-3 text-[11px] font-semibold text-amber-400/80 active:opacity-60">
                {genToken.isPending ? 'Regenerating…' : 'Regenerate token'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
