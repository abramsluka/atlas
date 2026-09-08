'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { startWalkthrough } from '@/components/Walkthrough'

// The first-run wizard (ONBOARDING_SPEC Part 2).
//
// Two rules shape everything here. Every step writes real data through the APIs
// that already exist — this is setup, not a slideshow. And everything after the
// welcome is skippable, because forcing seven screens on someone before they
// have seen the app is how you lose them. The API key banner and the existing
// 428 messaging are the safety net for anyone who skips.

type Profile = {
  age: number | null
  sex: string | null
  height_cm: number | null
  weight_lbs: number | null
  activity_hrs_per_week: number | null
  fitness_goal: string | null
  target_weight_lbs: number | null
  cut_pace: string | null
  daily_calorie_target: number | null
  daily_protein_target_g: number | null
  daily_carbs_target_g: number | null
  target_reasoning: string | null
}

const TOTAL_STEPS = 8

const KEY_PROVIDERS = [
  {
    id: 'gemini' as const,
    name: 'Google Gemini',
    tag: 'Free',
    blurb: 'Free tier, no credit card. The easiest place to start — you can switch later.',
    placeholder: 'AIza…',
    console: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'anthropic' as const,
    name: 'Anthropic (Claude)',
    tag: 'Best',
    blurb: 'What Atlas was built on. Pay-as-you-go, a few dollars a month, cap it with a spend limit.',
    placeholder: 'sk-ant-…',
    console: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai' as const,
    name: 'OpenAI',
    tag: 'Optional',
    blurb: 'Only powers food photos and voice notes. Skip unless you want those.',
    placeholder: 'sk-…',
    console: 'https://platform.openai.com/api-keys',
  },
]

const SUGGESTED_HABITS = [
  { emoji: '🛏️', name: 'Make bed', perWeek: 7 },
  { emoji: '🏋️', name: 'Workout', perWeek: 4 },
  { emoji: '📖', name: 'Read', perWeek: 7 },
  { emoji: '🧘', name: 'Meditate', perWeek: 7 },
  { emoji: '🚶', name: 'Walk', perWeek: 5 },
  { emoji: '🌙', name: 'In bed by 11', perWeek: 7 },
  { emoji: '🤸', name: 'Stretch', perWeek: 5 },
  { emoji: '📵', name: 'No phone in bed', perWeek: 7 },
]

const GOALS = [
  { id: 'cut', label: 'Cut', sub: 'Lose fat, preserve muscle' },
  { id: 'recomp', label: 'Recomp', sub: 'Lose fat and gain muscle at once' },
  { id: 'lean_bulk', label: 'Lean Bulk', sub: 'Build muscle, minimize fat gain' },
  { id: 'maintain', label: 'Maintain', sub: 'Stay where you are, stay fueled' },
]

const GYM_PRESETS = [
  { id: 'ppl', label: 'Push / Pull / Legs', days: ['Push', 'Pull', 'Legs'], rotation: ['Push', 'Pull', 'Legs', 'Rest'] },
  { id: 'ul', label: 'Upper / Lower', days: ['Upper', 'Lower'], rotation: ['Upper', 'Lower', 'Rest'] },
  { id: 'full', label: 'Full body', days: ['Full Body'], rotation: ['Full Body', 'Rest'] },
]

const inputClass =
  'w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-[15px] text-white placeholder-zinc-600 outline-none focus:border-white/40'
const labelClass = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-zinc-500'

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold transition-colors ${
        active
          ? 'border-green-400/50 bg-green-400/10 text-green-300'
          : 'border-white/10 bg-white/[0.02] text-zinc-400 active:text-white'
      }`}
    >
      {children}
    </button>
  )
}

export default function OnboardingClient({
  firstName,
  initialStep,
  hasKey,
  hasGymConfig,
  initialProfile,
}: {
  firstName: string
  initialStep: number
  hasKey: boolean
  hasGymConfig: boolean
  initialProfile: Profile
}) {
  const router = useRouter()
  const [step, setStep] = useState(initialStep)
  const [finishing, setFinishing] = useState(false)

  // ── Step 1: API key ───────────────────────────────────────────────────────
  const [provider, setProvider] = useState<'gemini' | 'anthropic' | 'openai'>('gemini')
  const [keyValue, setKeyValue] = useState('')
  const [keySaved, setKeySaved] = useState(hasKey)
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)

  async function saveKey() {
    setKeyBusy(true)
    setKeyError(null)
    try {
      const res = await fetch('/api/user/keys', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, key: keyValue.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setKeyError(json.error ?? 'Could not save that key.')
        return
      }
      setKeySaved(true)
      setKeyValue('')
      setStep(2)
    } catch {
      setKeyError('Network error. Try again.')
    } finally {
      setKeyBusy(false)
    }
  }

  // ── Step 2: health profile ────────────────────────────────────────────────
  const [age, setAge] = useState(initialProfile.age?.toString() ?? '')
  const [sex, setSex] = useState(initialProfile.sex ?? '')
  const [feet, setFeet] = useState(
    initialProfile.height_cm ? Math.floor(initialProfile.height_cm / 2.54 / 12).toString() : ''
  )
  const [inches, setInches] = useState(
    initialProfile.height_cm ? Math.round((initialProfile.height_cm / 2.54) % 12).toString() : ''
  )
  const [weight, setWeight] = useState(initialProfile.weight_lbs?.toString() ?? '')
  const [activityHrs, setActivityHrs] = useState(initialProfile.activity_hrs_per_week ?? 3)
  const [goal, setGoal] = useState(initialProfile.fitness_goal ?? 'recomp')
  const [targetWeight, setTargetWeight] = useState(initialProfile.target_weight_lbs?.toString() ?? '')
  const [cutPace, setCutPace] = useState(initialProfile.cut_pace ?? 'moderate')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const needsTargetWeight = goal === 'cut' || goal === 'lean_bulk'
  const profileValid = !!weight && !!age && !!sex && (!needsTargetWeight || !!targetWeight)

  async function saveProfile() {
    setProfileBusy(true)
    setProfileError(null)
    const heightCm =
      feet || inches
        ? Math.round((Number(feet || 0) * 12 + Number(inches || 0)) * 2.54)
        : initialProfile.height_cm
    const updates: Record<string, unknown> = {
      age: age ? Number(age) : null,
      sex: sex || null,
      height_cm: heightCm ?? null,
      weight_lbs: weight ? Number(weight) : null,
      activity_hrs_per_week: activityHrs,
      fitness_goal: goal,
      target_weight_lbs: needsTargetWeight && targetWeight ? Number(targetWeight) : null,
      cut_pace: goal === 'cut' || goal === 'lean_bulk' ? cutPace : null,
    }
    try {
      const res = await fetch('/api/health/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        setProfileError('Could not save that. Try again.')
        return
      }
      setStep(3)
    } catch {
      setProfileError('Network error. Try again.')
    } finally {
      setProfileBusy(false)
    }
  }

  // ── Step 3: calorie + protein targets ─────────────────────────────────────
  const [targets, setTargets] = useState<{
    daily_calories: number
    protein_g: number
    carbs_g: number
    reasoning: string
  } | null>(
    initialProfile.daily_calorie_target
      ? {
          daily_calories: initialProfile.daily_calorie_target,
          protein_g: initialProfile.daily_protein_target_g ?? 0,
          carbs_g: initialProfile.daily_carbs_target_g ?? 0,
          reasoning: initialProfile.target_reasoning ?? '',
        }
      : null
  )
  const [targetsBusy, setTargetsBusy] = useState(false)
  const [targetsError, setTargetsError] = useState<string | null>(null)

  async function calculateTargets() {
    setTargetsBusy(true)
    setTargetsError(null)
    try {
      // allowNoAi: the numbers are arithmetic, only the explanation sentence is
      // AI. Someone who skipped the key step still gets real targets here
      // instead of a "no API key" error inside their own setup.
      const res = await fetch('/api/health/calorie-target/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowNoAi: true }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTargetsError(json.error ?? 'Could not work out your targets.')
        return
      }
      setTargets(json)
    } catch {
      setTargetsError('Network error. Try again.')
    } finally {
      setTargetsBusy(false)
    }
  }

  // ── Step 4: starter habits ────────────────────────────────────────────────
  const [picked, setPicked] = useState<string[]>([])
  const [customHabit, setCustomHabit] = useState('')
  const [habitsBusy, setHabitsBusy] = useState(false)

  async function saveHabits() {
    setHabitsBusy(true)
    const chosen = SUGGESTED_HABITS.filter((h) => picked.includes(h.name))
    const custom = customHabit.trim()
    try {
      for (const h of chosen) {
        await fetch('/api/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: h.name, emoji: h.emoji, perWeek: h.perWeek }),
        })
      }
      if (custom) {
        await fetch('/api/habits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: custom, emoji: '✅', perWeek: 7 }),
        })
      }
    } catch {
      // A habit that fails to save is not worth blocking setup over — they can
      // add it from Home in two taps.
    } finally {
      setHabitsBusy(false)
      setStep(5)
    }
  }

  // ── Step 5: gym ───────────────────────────────────────────────────────────
  const [gymPreset, setGymPreset] = useState<string | null>(null)
  const [gymBusy, setGymBusy] = useState(false)

  async function saveGym() {
    const preset = GYM_PRESETS.find((p) => p.id === gymPreset)
    if (!preset) {
      setStep(6)
      return
    }
    setGymBusy(true)
    try {
      await fetch('/api/gym/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gyms: [{ id: 'g_default', name: 'Gym' }],
          days: preset.days.map((d) => ({ id: `d_${d.toLowerCase().replace(/\s+/g, '_')}`, name: d })),
          split_rotation: preset.rotation,
          units: 'lbs',
          upgrade_at_reps: 12,
        }),
      })
    } catch {
      // Same reasoning as habits: the Gym tab can set this up properly later.
    } finally {
      setGymBusy(false)
      setStep(6)
    }
  }

  // ── Finish ────────────────────────────────────────────────────────────────
  async function complete(withTour: boolean, href = '/') {
    setFinishing(true)
    try {
      await fetch('/api/onboarding', { method: 'POST' })
    } catch {}
    // includeSettings: someone who never saved a key needs to be shown where the
    // key lives, since that is the one thing standing between them and the AI.
    if (withTour) startWalkthrough(!keySaved)
    if (href.startsWith('/api/')) {
      window.location.href = href
    } else {
      router.push(href)
      router.refresh()
    }
  }

  // ── Shell ─────────────────────────────────────────────────────────────────
  const canSkipAll = step > 0

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-10 pt-8">
      {/* Progress */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <span
            key={i}
            className="h-[3px] flex-1 rounded-full transition-colors"
            style={{ background: i <= step ? 'rgba(74,222,128,0.75)' : 'rgba(255,255,255,0.10)' }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center">
        <span className="font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-zinc-600">
          Step {step + 1} of {TOTAL_STEPS}
        </span>
        {canSkipAll && (
          <button
            onClick={() => complete(false)}
            disabled={finishing}
            className="ml-auto text-[11px] font-semibold text-zinc-600 underline active:text-zinc-400"
          >
            Skip setup
          </button>
        )}
      </div>

      <div className="flex-1 pt-6">
        {/* ── 0. Welcome ─────────────────────────────────────────────────── */}
        {step === 0 && (
          <div>
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-white">
              {firstName ? `Welcome, ${firstName}.` : 'Welcome to Atlas.'}
            </h1>
            <p className="mt-3 text-[13.5px] leading-relaxed text-zinc-400">
              Atlas keeps your training, food, sleep, habits and journal in one place, and puts an
              AI coach on top that has actually read all of it.
            </p>
            <div className="mt-5 space-y-3">
              <div className="cosmic-card p-4">
                <p className="text-[13px] font-semibold text-white">It runs on your own AI key</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                  Your data and your billing stay yours, and nothing is pooled with anyone else.
                  Google&apos;s Gemini has a free tier if you would rather not pay anything.
                </p>
              </div>
              <div className="cosmic-card p-4">
                <p className="text-[13px] font-semibold text-white">This takes about three minutes</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
                  Everything after this screen can be skipped and set up later from inside the app.
                </p>
              </div>
            </div>
            <button
              onClick={() => setStep(1)}
              className="mt-6 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a]"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              Get started
            </button>
          </div>
        )}

        {/* ── 1. API key ─────────────────────────────────────────────────── */}
        {step === 1 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">Connect an AI</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              This is the one bit of setup that is not optional if you want the coaching. Pick a
              provider, paste a key, done.{' '}
              <a href="/guide/api-key" target="_blank" className="text-green-400 underline">
                How do I get a key?
              </a>
            </p>

            {keySaved && (
              <p className="mt-4 rounded-[10px] border border-green-400/25 bg-green-400/[0.07] px-3 py-2.5 text-[12.5px] text-green-300">
                Key saved. You can add another provider later in Settings.
              </p>
            )}

            <div className="mt-4 space-y-2">
              {KEY_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id)
                    setKeyError(null)
                  }}
                  className={`w-full rounded-[12px] border p-3 text-left transition-colors ${
                    provider === p.id
                      ? 'border-green-400/45 bg-green-400/[0.06]'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-white">{p.name}</span>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${
                        p.tag === 'Free' ? 'bg-green-400/15 text-green-300' : 'bg-white/8 text-zinc-400'
                      }`}
                    >
                      {p.tag}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-500">{p.blurb}</p>
                </button>
              ))}
            </div>

            <div className="mt-4">
              <input
                value={keyValue}
                onChange={(e) => {
                  setKeyValue(e.target.value)
                  setKeyError(null)
                }}
                placeholder={KEY_PROVIDERS.find((p) => p.id === provider)!.placeholder}
                autoComplete="off"
                spellCheck={false}
                className={`${inputClass} font-mono text-[13px]`}
              />
              <a
                href={KEY_PROVIDERS.find((p) => p.id === provider)!.console}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-block text-[11.5px] text-zinc-500 underline"
              >
                Open the {KEY_PROVIDERS.find((p) => p.id === provider)!.name} console →
              </a>
              {keyError && <p className="mt-2 text-[12px] text-red-400/90">{keyError}</p>}
            </div>

            <button
              onClick={saveKey}
              disabled={keyBusy || !keyValue.trim()}
              className="mt-4 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-40"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {keyBusy ? 'Checking the key…' : 'Save key and continue'}
            </button>
            <button
              onClick={() => setStep(2)}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              {keySaved ? 'Continue' : 'I’ll do this later'}
            </button>
          </div>
        )}

        {/* ── 2. Health profile ──────────────────────────────────────────── */}
        {step === 2 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">About you</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Used to work out your calorie and protein targets, and to give the coach something to
              reason about.
            </p>

            <div className="mt-5 space-y-4">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className={labelClass}>Age</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="13"
                    max="100"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    placeholder="24"
                    className={inputClass}
                  />
                </div>
                <div className="flex-1">
                  <label className={labelClass}>Weight (lbs)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="60"
                    max="600"
                    step="0.5"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="175"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Sex</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { v: 'm', l: 'Male' },
                    { v: 'f', l: 'Female' },
                    { v: 'o', l: 'Other' },
                  ].map((o) => (
                    <Pill key={o.v} active={sex === o.v} onClick={() => setSex(o.v)}>
                      {o.l}
                    </Pill>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>Height</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min="3"
                    max="8"
                    value={feet}
                    onChange={(e) => setFeet(e.target.value)}
                    placeholder="5"
                    className={inputClass}
                  />
                  <span className="text-[12px] text-zinc-500">ft</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="0"
                    max="11"
                    value={inches}
                    onChange={(e) => setInches(e.target.value)}
                    placeholder="10"
                    className={inputClass}
                  />
                  <span className="text-[12px] text-zinc-500">in</span>
                </div>
              </div>

              <div>
                <label className={labelClass}>Training — hours per week</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { v: 1, l: '0–2' },
                    { v: 3, l: '2–5' },
                    { v: 7, l: '5–10' },
                    { v: 14, l: '10+' },
                  ].map((o) => (
                    <Pill key={o.v} active={activityHrs === o.v} onClick={() => setActivityHrs(o.v)}>
                      {o.l}
                    </Pill>
                  ))}
                </div>
              </div>

              <div>
                <label className={labelClass}>Goal</label>
                <div className="space-y-2">
                  {GOALS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGoal(g.id)}
                      className={`w-full rounded-[10px] border px-3 py-2.5 text-left transition-colors ${
                        goal === g.id
                          ? 'border-green-400/45 bg-green-400/[0.06]'
                          : 'border-white/10 bg-white/[0.02]'
                      }`}
                    >
                      <span className="text-[13px] font-semibold text-white">{g.label}</span>
                      <span className="ml-2 text-[11.5px] text-zinc-500">{g.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {needsTargetWeight && (
                <div>
                  <label className={labelClass}>
                    {goal === 'cut' ? 'Target weight (lbs)' : 'Goal weight (lbs)'}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="60"
                    max="600"
                    step="0.5"
                    value={targetWeight}
                    onChange={(e) => setTargetWeight(e.target.value)}
                    placeholder={goal === 'cut' ? '165' : '185'}
                    className={inputClass}
                  />
                </div>
              )}

              {goal === 'cut' && (
                <div>
                  <label className={labelClass}>Pace</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['slow', 'moderate', 'aggressive'].map((p) => (
                      <Pill key={p} active={cutPace === p} onClick={() => setCutPace(p)}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </Pill>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {profileError && <p className="mt-3 text-[12px] text-red-400/90">{profileError}</p>}

            <button
              onClick={saveProfile}
              disabled={profileBusy || !profileValid}
              className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-40"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {profileBusy ? 'Saving…' : 'Continue'}
            </button>
            <button
              onClick={() => setStep(3)}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              Skip this
            </button>
          </div>
        )}

        {/* ── 3. Targets ─────────────────────────────────────────────────── */}
        {step === 3 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">Your daily targets</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Worked out from the numbers you just gave. These drive the food tracking on the Health
              tab, and you can change them any time.
            </p>

            {!targets && (
              <button
                onClick={calculateTargets}
                disabled={targetsBusy}
                className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-40"
                style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
              >
                {targetsBusy ? 'Working them out…' : 'Calculate my targets'}
              </button>
            )}

            {targetsError && (
              <div className="mt-4 rounded-[10px] border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5">
                <p className="text-[12.5px] text-amber-200/90">{targetsError}</p>
                <button
                  onClick={() => setStep(2)}
                  className="mt-1 text-[11.5px] font-semibold text-amber-300 underline"
                >
                  Go back and fill in your details
                </button>
              </div>
            )}

            {targets && (
              <>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    { l: 'Calories', v: targets.daily_calories, u: '' },
                    { l: 'Protein', v: targets.protein_g, u: 'g' },
                    { l: 'Carbs', v: targets.carbs_g, u: 'g' },
                  ].map((t) => (
                    <div key={t.l} className="cosmic-card px-3 py-3 text-center">
                      <p className="text-[19px] font-bold text-white">
                        {t.v}
                        <span className="text-[12px] text-zinc-500">{t.u}</span>
                      </p>
                      <p className="mt-0.5 font-mono text-[9px] font-extrabold uppercase tracking-[0.14em] text-zinc-500">
                        {t.l}
                      </p>
                    </div>
                  ))}
                </div>
                {targets.reasoning && (
                  <p className="mt-3 text-[12.5px] leading-relaxed text-zinc-400">
                    {targets.reasoning}
                  </p>
                )}
                <button
                  onClick={() => setStep(4)}
                  className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a]"
                  style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
                >
                  Continue
                </button>
              </>
            )}

            <button
              onClick={() => setStep(4)}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              Skip this
            </button>
          </div>
        )}

        {/* ── 4. Habits ──────────────────────────────────────────────────── */}
        {step === 4 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">Pick a few habits</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              These show up on your home screen as a streak you tick off each day. Two or three is
              plenty to start with.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {SUGGESTED_HABITS.map((h) => (
                <Pill
                  key={h.name}
                  active={picked.includes(h.name)}
                  onClick={() =>
                    setPicked((cur) =>
                      cur.includes(h.name) ? cur.filter((n) => n !== h.name) : [...cur, h.name]
                    )
                  }
                >
                  <span className="mr-1">{h.emoji}</span>
                  {h.name}
                </Pill>
              ))}
            </div>

            <div className="mt-4">
              <label className={labelClass}>Or add your own</label>
              <input
                value={customHabit}
                onChange={(e) => setCustomHabit(e.target.value)}
                placeholder="e.g. Practice guitar"
                className={inputClass}
              />
            </div>

            <button
              onClick={saveHabits}
              disabled={habitsBusy}
              className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-40"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {habitsBusy
                ? 'Adding…'
                : picked.length || customHabit.trim()
                  ? `Add ${picked.length + (customHabit.trim() ? 1 : 0)} and continue`
                  : 'Continue'}
            </button>
            <button
              onClick={() => setStep(5)}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              Skip this
            </button>
          </div>
        )}

        {/* ── 5. Gym ─────────────────────────────────────────────────────── */}
        {step === 5 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">How do you train?</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Sets up your training split so the Gym tab knows what today is. Skip it if you do not
              lift, or if you would rather set it up properly later.
            </p>

            {hasGymConfig && (
              <p className="mt-4 text-[12px] text-zinc-500">
                You already have a split configured. Picking one here replaces it.
              </p>
            )}

            <div className="mt-5 space-y-2">
              {GYM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setGymPreset(p.id)}
                  className={`w-full rounded-[10px] border px-3 py-3 text-left transition-colors ${
                    gymPreset === p.id
                      ? 'border-green-400/45 bg-green-400/[0.06]'
                      : 'border-white/10 bg-white/[0.02]'
                  }`}
                >
                  <span className="text-[13px] font-semibold text-white">{p.label}</span>
                  <span className="ml-2 text-[11.5px] text-zinc-500">{p.rotation.join(' · ')}</span>
                </button>
              ))}
            </div>

            <button
              onClick={saveGym}
              disabled={gymBusy}
              className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-40"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {gymBusy ? 'Saving…' : 'Continue'}
            </button>
            <button
              onClick={() => setStep(6)}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              I don’t lift
            </button>
          </div>
        )}

        {/* ── 6. Wearable ────────────────────────────────────────────────── */}
        {step === 6 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">Wearing anything?</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              If you have an Oura ring or a WHOOP, connecting it pulls in your sleep and recovery so
              the coach can tell you when to back off. You can only connect one at a time.
            </p>

            <div className="mt-5 space-y-2">
              {/* Connecting leaves Atlas for the provider's consent screen and comes
                  back to /health, so setup is marked done first — otherwise they
                  would be bounced straight back into this wizard on return. The
                  walkthrough is queued and picks up wherever they land. */}
              <button
                onClick={() => complete(true, '/api/health/oura/connect')}
                disabled={finishing}
                className="w-full rounded-[10px] border border-white/12 bg-white/[0.03] py-3 text-[13px] font-semibold text-white active:opacity-70"
              >
                Connect Oura Ring
              </button>
              <button
                onClick={() => complete(true, '/api/health/whoop/connect')}
                disabled={finishing}
                className="w-full rounded-[10px] border border-white/12 bg-white/[0.03] py-3 text-[13px] font-semibold text-white active:opacity-70"
              >
                Connect WHOOP
              </button>
            </div>

            <button
              onClick={() => setStep(7)}
              className="mt-5 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a]"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              Neither, continue
            </button>
          </div>
        )}

        {/* ── 7. Done + walkthrough ──────────────────────────────────────── */}
        {step === 7 && (
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">
              {firstName ? `You’re set, ${firstName}.` : 'You’re set.'}
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">
              Last thing: a quick tour of the five tabs, over the real app, about thirty seconds. You
              can quit it at any point and replay it later from Settings.
            </p>

            {!keySaved && (
              <p className="mt-4 rounded-[10px] border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2.5 text-[12.5px] leading-relaxed text-amber-200/90">
                You skipped the API key, so anything AI-powered will ask for one. Add it whenever you
                like under Settings → API keys.
              </p>
            )}

            <button
              onClick={() => complete(true)}
              disabled={finishing}
              className="mt-6 w-full rounded-xl py-3 text-[14px] font-bold text-[#05130a] disabled:opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
            >
              {finishing ? 'One moment…' : 'Show me around'}
            </button>
            <button
              onClick={() => complete(false)}
              disabled={finishing}
              className="mt-2 w-full py-2 text-[12.5px] font-semibold text-zinc-500 active:text-zinc-300"
            >
              Skip the tour, take me in
            </button>
          </div>
        )}
      </div>

      {step > 0 && step < 7 && (
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="mt-6 self-start text-[12px] font-semibold text-zinc-600 active:text-zinc-400"
        >
          ← Back
        </button>
      )}
    </main>
  )
}
