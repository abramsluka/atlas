'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { startWalkthrough } from '@/components/Walkthrough'
import { fmtClockHour, scheduleHours } from '@/lib/schedule'

type KeyProvider = 'anthropic' | 'openai' | 'gemini'
type KeyStatus = { set: boolean; last4: string | null }
type KeysResponse = { anthropic: KeyStatus; openai: KeyStatus; gemini: KeyStatus }
type AiCategory = 'coaching' | 'analysis' | 'voice'
type PrefsResponse = {
  prefs: Partial<Record<AiCategory, KeyProvider>>
  owned: KeyProvider[]
  allowed: Record<AiCategory, KeyProvider[]>
}

const PROVIDERS: Array<{
  id: KeyProvider
  name: string
  powers: string
  consoleUrl: string
  consoleLabel: string
  placeholder: string
}> = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    powers: 'All AI coaching — gym coach, mentor, journal reflection, daily briefing, health insights.',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleLabel: 'console.anthropic.com',
    placeholder: 'sk-ant-…',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    powers: 'Food logging AI (photo + text parsing) and voice transcription.',
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleLabel: 'platform.openai.com',
    placeholder: 'sk-…',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    powers: 'Can run the coaching instead of Anthropic. Has a free tier — no credit card needed.',
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    consoleLabel: 'aistudio.google.com',
    placeholder: 'AIza…',
  },
]

const PROVIDER_NAME: Record<KeyProvider, string> = {
  anthropic: 'Claude',
  openai: 'GPT',
  gemini: 'Gemini',
}

function KeyCard({ provider, status }: { provider: (typeof PROVIDERS)[number]; status: KeyStatus | undefined }) {
  const qc = useQueryClient()
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch('/api/user/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id, key }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to save key')
      return json
    },
    onSuccess: () => {
      setValue('')
      setEditing(false)
      setError(null)
      qc.invalidateQueries({ queryKey: ['user-keys'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/user/keys', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: provider.id }),
      })
      if (!res.ok) throw new Error('Failed to remove key')
    },
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ['user-keys'] })
    },
    onError: (e: Error) => setError(e.message),
  })

  const showInput = editing || !status?.set

  return (
    <div className="cosmic-card p-4">
      <div className="flex items-center gap-2">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: status?.set ? '#4ade80' : '#71717a' }}
        />
        <span className="text-[13px] font-semibold text-white">{provider.name}</span>
        {status?.set && (
          <span className="text-[11px] font-mono text-zinc-500">•••• {status.last4}</span>
        )}
        {status?.set && !editing && (
          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] font-semibold text-white/40 hover:text-white/60 underline"
            >
              Replace
            </button>
            <button
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="text-[11px] font-semibold text-red-400/60 hover:text-red-400/90 underline disabled:opacity-50"
            >
              {remove.isPending ? 'Removing…' : 'Remove'}
            </button>
          </div>
        )}
      </div>

      <p className="mt-1.5 text-[11.5px] text-zinc-500 leading-relaxed">{provider.powers}</p>

      {showInput && (
        <div className="mt-2.5">
          <div className="flex gap-2">
            <input
              type="password"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null) }}
              placeholder={provider.placeholder}
              autoComplete="off"
              spellCheck={false}
              className="flex-1 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-[12px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/25"
            />
            <button
              onClick={() => value.trim() && save.mutate(value.trim())}
              disabled={save.isPending || !value.trim()}
              className="rounded-lg bg-white/10 hover:bg-white/15 px-3 py-2 text-[12px] font-semibold text-white disabled:opacity-40"
            >
              {save.isPending ? 'Checking…' : 'Save'}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(false); setValue(''); setError(null) }}
                className="px-1 text-[12px] text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            )}
          </div>
          {error && <p className="mt-1.5 text-[11px] text-red-400/90">{error}</p>}
          <p className="mt-1.5 text-[10.5px] text-zinc-600">
            Create one at{' '}
            <a href={provider.consoleUrl} target="_blank" rel="noreferrer" className="underline text-zinc-500 hover:text-zinc-400">
              {provider.consoleLabel}
            </a>
            . Stored encrypted; only the last 4 characters are ever shown again.
          </p>
        </div>
      )}
    </div>
  )
}

// Which provider runs which kind of work. Phase 1 wires 'coaching' only —
// photos and voice still run on their existing fixed paths.
const CATEGORY_COPY: Record<AiCategory, { title: string; blurb: string }> = {
  coaching: {
    title: 'Coaching & chat',
    blurb: 'Daily briefing, gym and health coaches, journal reflections.',
  },
  analysis: { title: 'Photos & analysis', blurb: 'Food photos and receipt scanning.' },
  voice: { title: 'Voice', blurb: 'Voice notes and journal audio.' },
}

function ProviderPicker() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data } = useQuery<PrefsResponse>({
    queryKey: ['ai-prefs'],
    queryFn: async () => (await fetch('/api/user/ai-prefs')).json(),
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: async (v: { category: AiCategory; provider: KeyProvider }) => {
      const res = await fetch('/api/user/ai-prefs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      return json
    },
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['ai-prefs'] }) },
    onError: (e: Error) => setError(e.message),
  })

  if (!data) return null
  const owned = data.owned ?? []
  const category: AiCategory = 'coaching'
  const allowed = data.allowed?.[category] ?? []
  const current = data.prefs?.[category] ?? (owned.includes('anthropic') ? 'anthropic' : owned[0])

  return (
    <div className="cosmic-card p-4">
      <div className="text-[13px] font-semibold text-white">{CATEGORY_COPY[category].title}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">{CATEGORY_COPY[category].blurb}</p>

      {owned.length === 0 ? (
        <p className="mt-2.5 text-[11.5px] text-zinc-600">Add a key below to choose a provider.</p>
      ) : (
        <div className="mt-2.5 flex gap-1.5">
          {allowed.map((p) => {
            const has = owned.includes(p)
            const active = current === p
            return (
              <button
                key={p}
                disabled={!has || save.isPending}
                onClick={() => save.mutate({ category, provider: p })}
                title={has ? undefined : `Add your ${p} key first`}
                className="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-30"
                style={
                  active
                    ? { color: '#eafff2', background: 'rgba(74,222,128,0.13)', boxShadow: 'inset 0 0 0 1px rgba(74,222,128,0.32)' }
                    : { color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.04)' }
                }
              >
                {PROVIDER_NAME[p]}
              </button>
            )
          })}
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-red-400/90">{error}</p>}
    </div>
  )
}

// Wake / sleep times. Drives the home day ring, the energy curve's start and
// end of day, and the caffeine cutoff. Wake is a fallback only: a real
// measured wake from the wearable still wins on mornings it has synced.
type ScheduleResponse = { timezone: string | null; wake_time: string | null; sleep_time: string | null }

function ScheduleCard() {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data } = useQuery<ScheduleResponse>({
    queryKey: ['user-settings'],
    queryFn: async () => (await fetch('/api/user/settings')).json(),
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: async (patch: Partial<Pick<ScheduleResponse, 'wake_time' | 'sleep_time'>>) => {
      const res = await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save')
      return patch
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['user-settings'] })
      const prev = qc.getQueryData<ScheduleResponse>(['user-settings'])
      if (prev) qc.setQueryData<ScheduleResponse>(['user-settings'], { ...prev, ...patch })
      return { prev }
    },
    onError: (e: Error, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['user-settings'], ctx.prev)
      setError(e.message)
    },
    onSuccess: () => setError(null),
    onSettled: () => qc.invalidateQueries({ queryKey: ['user-settings'] }),
  })

  const wake = data?.wake_time ?? ''
  const sleep = data?.sleep_time ?? ''
  const hours = scheduleHours(wake || null, sleep || null)
  const summary =
    hours.wakeHour != null && hours.sleepHour != null
      ? `${fmtClockHour(hours.wakeHour)} – ${fmtClockHour(hours.sleepHour)} · ${((hours.sleepHour - hours.wakeHour)).toFixed(1).replace(/\.0$/, '')}h awake`
      : 'Unset — Atlas assumes 8:00 AM – 12:00 AM'

  const field = (label: string, key: 'wake_time' | 'sleep_time', value: string) => (
    <label className="flex-1 min-w-0">
      <span className="block text-[10.5px] font-semibold tracking-wide uppercase text-zinc-500">{label}</span>
      <input
        type="time"
        value={value}
        disabled={!data}
        onChange={(e) => save.mutate({ [key]: e.target.value || null })}
        className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-2.5 py-2 text-[13px] font-mono text-zinc-200 focus:outline-none focus:border-white/25 disabled:opacity-40 [color-scheme:dark]"
      />
    </label>
  )

  return (
    <div className="cosmic-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-white">Wake &amp; sleep</span>
        {(wake || sleep) && (
          <button
            onClick={() => save.mutate({ wake_time: null, sleep_time: null })}
            className="ml-auto text-[11px] font-semibold text-white/40 hover:text-white/60 underline"
          >
            Clear
          </button>
        )}
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
        Sets the day ring on Home and where the energy curve starts and ends. If your wearable
        recorded last night, that wake time is used for the day instead.
      </p>
      <div className="mt-2.5 flex gap-3">
        {field('Wake', 'wake_time', wake)}
        {field('Sleep', 'sleep_time', sleep)}
      </div>
      <p className="mt-2 text-[10.5px] font-mono text-zinc-600">{summary}</p>
      {error && <p className="mt-1.5 text-[11px] text-red-400/90">{error}</p>}
    </div>
  )
}

export default function SettingsClient({ email }: { email: string }) {
  const router = useRouter()
  const { data: keys } = useQuery<KeysResponse>({
    queryKey: ['user-keys'],
    queryFn: async () => (await fetch('/api/user/keys')).json(),
    staleTime: 30_000,
  })

  return (
    <main className="max-w-lg mx-auto px-4 pt-6 pb-24">
      <Link href="/" className="-ml-1 inline-block px-1 py-2 text-sm text-zinc-400 active:text-zinc-200">
        ← Back
      </Link>
      <h1 className="mt-1 text-[17px] font-bold text-white">Settings</h1>
      <p className="mt-0.5 text-[11.5px] text-zinc-500">{email}</p>

      <h2 className="mt-6 mb-2 font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
        Your day
      </h2>
      <ScheduleCard />

      <h2 className="mt-6 mb-2 font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
        Which AI
      </h2>
      <ProviderPicker />

      <h2 className="mt-6 mb-2 font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
        API keys
      </h2>
      <p className="mb-3 text-[11.5px] text-zinc-500 leading-relaxed">
        Atlas runs its AI on your own keys, billed to your own accounts. Nothing here is shared
        between users. <span className="text-zinc-400">No credit card? Gemini has a free tier.</span>{' '}
        <a href="/guide/api-key" className="text-green-400 underline">How to get a key →</a>
      </p>
      <div className="space-y-3">
        {PROVIDERS.map((p) => (
          <KeyCard key={p.id} provider={p} status={keys?.[p.id]} />
        ))}
      </div>

      <h2 className="mt-6 mb-2 font-mono text-[9.5px] font-extrabold tracking-[0.16em] uppercase text-zinc-500">
        Getting around
      </h2>
      <div className="cosmic-card p-4">
        <p className="text-[13px] font-semibold text-white">Replay the walkthrough</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">
          The short tour of the five tabs you saw when you signed up.
        </p>
        <button
          onClick={() => {
            // Queue it, then go home. It starts on arrival, and Home is the one
            // screen where the final stop's Settings link exists to be spotlit.
            // No coaching key means the tour keeps that last stop.
            startWalkthrough(!(keys?.anthropic.set || keys?.gemini.set))
            router.push('/')
          }}
          className="mt-2.5 rounded-lg border border-white/12 px-3 py-2 text-[12px] font-semibold text-white/70 active:opacity-70"
        >
          Start the tour
        </button>
      </div>
    </main>
  )
}
