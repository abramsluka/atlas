'use client'

import { useEffect, useRef, useState } from 'react'
import { useEstimateFood, useLogManualFood } from '@/features/food/mutations'
import { useFoodItems } from '@/features/food/queries'
import { NoApiKeyClientError, type KeyProvider } from '@/lib/apiKeyError'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'
import type {
  BarcodeLookup,
  EstimateFinal,
  EstimateQuestion,
  WizardAnswer,
  FoodItem,
} from '@/features/food/types'
import { nextUnit, toGrams, type AmountUnit } from '@/features/food/units'

// ─── Shared sheet chrome ──────────────────────────────────────────────────────

function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4"
      style={{ backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-[#111113] border border-white/[0.14] p-5 space-y-4 max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function chipClass(active: boolean): string {
  return `rounded-xl border px-3 py-2.5 text-sm text-left transition-colors ${
    active
      ? 'border-emerald-300/60 bg-emerald-300/10 text-white'
      : 'border-white/[0.12] bg-white/[0.03] text-zinc-300 active:opacity-70'
  }`
}

// ─── Add Food / Quick Drink wizard ───────────────────────────────────────────

const DRINK_PRESETS = ['Water', 'Coffee', 'Orange juice', 'Protein shake', 'Soda', 'Beer']

const CONFIDENCE_COLOR: Record<string, string> = {
  high: 'text-emerald-300',
  medium: 'text-yellow-300',
  low: 'text-orange-300',
}

export function FoodWizardSheet({
  kind,
  initialDescription,
  onClose,
  onSaved,
}: {
  kind: 'food' | 'drink'
  initialDescription?: string
  onClose: () => void
  onSaved: (res: { water_logged: boolean; volume_oz: number | null; caffeine_logged?: boolean; caffeine_mg?: number }) => void
}) {
  const estimate = useEstimateFood()
  const logManual = useLogManualFood()

  const [phase, setPhase] = useState<'input' | 'question' | 'final'>('input')
  const [description, setDescription] = useState(initialDescription ?? '')
  const [answers, setAnswers] = useState<WizardAnswer[]>([])
  const [question, setQuestion] = useState<EstimateQuestion | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [final, setFinal] = useState<EstimateFinal | null>(null)
  const [calOverride, setCalOverride] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [noKeyProvider, setNoKeyProvider] = useState<KeyProvider | null>(null)

  async function runEstimate(desc: string, ans: WizardAnswer[]) {
    setError(null)
    setNoKeyProvider(null)
    try {
      const result = await estimate.mutateAsync({ description: desc, kind, answers: ans })
      setSelected(null)
      setOtherOpen(false)
      setOtherText('')
      if (result.status === 'question') {
        setQuestion(result)
        setPhase('question')
      } else {
        setFinal(result)
        setCalOverride(String(result.calories))
        setPhase('final')
      }
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setNoKeyProvider(err.provider)
      else setError(String(err instanceof Error ? err.message : err))
    }
  }

  function start(desc: string) {
    const d = desc.trim()
    if (!d) return
    setDescription(d)
    setAnswers([])
    runEstimate(d, [])
  }

  // Launched from the ingredient page's "Estimate it with AI" — run immediately
  // so the follow-up questions appear without a second tap on "Estimate".
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current) return
    if (initialDescription && initialDescription.trim()) {
      autoRan.current = true
      start(initialDescription)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function submitAnswer(skipped: boolean) {
    if (!question) return
    const answer = skipped ? '' : (otherOpen && otherText.trim() ? otherText.trim() : selected ?? '')
    if (!skipped && !answer) return
    const next: WizardAnswer[] = [
      ...answers,
      { question: question.question, answer, ...(skipped ? { skipped: true } : {}) },
    ]
    setAnswers(next)
    runEstimate(description, next)
  }

  function goBack() {
    if (answers.length === 0) {
      setPhase('input')
      setQuestion(null)
      return
    }
    const popped = answers.slice(0, -1)
    setAnswers(popped)
    runEstimate(description, popped)
  }

  async function save() {
    if (!final) return
    setError(null)
    setNoKeyProvider(null)
    const calories = Math.round(Number(calOverride))
    try {
      const res = await logManual.mutateAsync({
        item_name: final.item_name,
        calories: Number.isFinite(calories) && calories > 0 ? calories : final.calories,
        protein_g: final.protein_g,
        carbs_g: final.carbs_g,
        confidence: final.confidence,
        notes: final.notes,
        portion_desc: final.portion_desc,
        volume_oz: final.volume_oz,
        is_hydrating: final.is_hydrating,
        caffeine_mg: final.caffeine_mg,
        source: kind === 'drink' ? 'drink' : 'text',
      })
      onSaved({
        water_logged: res.water_logged,
        volume_oz: final.volume_oz,
        caffeine_logged: res.caffeine_logged,
        caffeine_mg: final.caffeine_mg,
      })
      onClose()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  const busy = estimate.isPending || logManual.isPending
  const nextDisabled = busy || (!selected && !(otherOpen && otherText.trim()))

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-white">
          {kind === 'drink' ? 'Quick drink' : 'Add food'}
        </p>
        <button onClick={onClose} className="text-zinc-500 text-sm active:opacity-60">✕</button>
      </div>

      {noKeyProvider ? <NoApiKeyNotice provider={noKeyProvider} /> : error && <p className="text-xs text-red-400">{error}</p>}

      {phase === 'input' && (
        <div className="space-y-3">
          {kind === 'drink' && (
            <div className="flex flex-wrap gap-2">
              {DRINK_PRESETS.map(p => (
                <button key={p} onClick={() => start(p)} disabled={busy} className={chipClass(false)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') start(description) }}
            placeholder={kind === 'drink' ? 'e.g. glass of orange juice' : 'e.g. chicken breast and rice'}
            autoFocus
            className="w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-3 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
          />
          <button
            onClick={() => start(description)}
            disabled={busy || !description.trim()}
            className="w-full h-12 rounded-xl text-sm font-semibold text-black disabled:opacity-40 active:opacity-80"
            style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
          >
            {estimate.isPending ? 'Estimating…' : 'Estimate'}
          </button>
        </div>
      )}

      {phase === 'question' && question && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-white">{question.question}</p>
            {question.reasoning && (
              <p className="text-xs italic text-zinc-400 mt-1 leading-relaxed">
                {question.reasoning}
                {question.calorie_delta != null ? ` (±${question.calorie_delta} kcal)` : ''}
              </p>
            )}
            <p className="text-[10px] text-zinc-600 mt-0.5">Question {question.step} of up to 3</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {question.options.map(opt => (
              <button
                key={opt}
                onClick={() => { setSelected(opt); setOtherOpen(false) }}
                disabled={busy}
                className={chipClass(selected === opt && !otherOpen)}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={() => { setOtherOpen(true); setSelected(null) }}
              disabled={busy}
              className={chipClass(otherOpen)}
            >
              Other…
            </button>
          </div>
          {otherOpen && (
            <input
              type="text"
              value={otherText}
              onChange={e => setOtherText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && otherText.trim()) submitAnswer(false) }}
              placeholder="Type your answer"
              autoFocus
              className="w-full rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
            />
          )}
          <div className="flex items-center justify-between pt-1">
            <div className="flex gap-4">
              <button onClick={goBack} disabled={busy} className="text-xs text-zinc-600 underline active:opacity-70">
                Back
              </button>
              <button onClick={() => submitAnswer(true)} disabled={busy} className="text-xs text-zinc-500 underline active:opacity-70">
                Skip
              </button>
            </div>
            <button
              onClick={() => submitAnswer(false)}
              disabled={nextDisabled}
              className="h-10 px-6 rounded-xl text-sm font-semibold text-black disabled:opacity-40 active:opacity-80"
              style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
            >
              {estimate.isPending ? '…' : 'Next'}
            </button>
          </div>
        </div>
      )}

      {phase === 'final' && final && (
        <div className="space-y-3">
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-4 py-3 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-white">{final.item_name}</p>
              <span className={`text-[10px] uppercase tracking-wide ${CONFIDENCE_COLOR[final.confidence]}`}>
                {final.confidence}
              </span>
            </div>
            <p className="text-xs text-zinc-500">{final.portion_desc}</p>
            <div className="flex items-center gap-3 pt-1">
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  inputMode="numeric"
                  value={calOverride}
                  onChange={e => setCalOverride(e.target.value)}
                  className="w-20 rounded-lg border border-white/[0.12] bg-black/30 px-2 py-1.5 text-sm font-bold text-white outline-none focus:border-white/30"
                />
                <span className="text-xs text-zinc-500">cal</span>
              </div>
              <span className="text-xs text-zinc-400">{Math.round(final.protein_g)}g P · {Math.round(final.carbs_g)}g C</span>
            </div>
            {final.is_hydrating && final.volume_oz != null && (
              <p className="text-[10px] text-sky-300/70 pt-1">Will also log +{final.volume_oz} oz water</p>
            )}
            {final.notes && <p className="text-[10px] text-zinc-600 pt-1">{final.notes}</p>}
          </div>
          <div className="flex gap-3">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 h-12 rounded-xl text-sm font-semibold text-black disabled:opacity-40 active:opacity-80"
              style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
            >
              {logManual.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => { setPhase('input'); setFinal(null); setAnswers([]) }}
              disabled={busy}
              className="h-12 px-4 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-semibold text-zinc-400 active:opacity-80"
            >
              Start over
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

// ─── Barcode scanner + serving picker flow ───────────────────────────────────

export function BarcodeScannerOverlay({
  onClose,
  onCode,
}: {
  onClose: () => void
  onCode: (code: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const firedRef = useRef(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let interval: ReturnType<typeof setInterval> | null = null
    let cancelled = false

    ;(async () => {
      try {
        // Lazy import — WASM only loads when the scanner opens
        const { BarcodeDetector } = await import('barcode-detector/ponyfill')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          return
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        const detector = new BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
        })
        interval = setInterval(async () => {
          const video = videoRef.current
          if (!video || video.readyState < 2 || firedRef.current) return
          try {
            const codes = await detector.detect(video)
            const value = codes[0]?.rawValue
            if (value) {
              firedRef.current = true
              if (interval) clearInterval(interval)
              navigator.vibrate?.(50)
              onCode(value)
            }
          } catch {
            // detection errors on individual frames are expected; keep scanning
          }
        }, 200)
      } catch {
        setCameraError('Camera unavailable — check permissions, or type the barcode number below.')
      }
    })()

    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [onCode])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
        <button onClick={onClose} className="text-white/60 text-sm active:opacity-60">← Back</button>
        <span className="text-xs text-white/40 uppercase tracking-widest">Scan barcode</span>
        <span className="w-12" />
      </div>

      <div className="relative flex-1 overflow-hidden">
        {cameraError ? (
          <div className="flex h-full items-center justify-center px-8">
            <p className="text-sm text-zinc-400 text-center">{cameraError}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
            {/* Reticle */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[80%] max-w-sm h-36 rounded-2xl border-2 border-white/50 relative">
                <div className="absolute left-3 right-3 top-1/2 h-0.5 bg-emerald-300/80 animate-pulse" />
              </div>
            </div>
          </>
        )}
      </div>

      <div className="px-4 py-4 space-y-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <p className="text-[10px] text-zinc-600 text-center">or type the number under the barcode</p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={manual}
            onChange={e => setManual(e.target.value.replace(/\D/g, ''))}
            placeholder="e.g. 3017620422003"
            className="flex-1 rounded-xl border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-white/30"
          />
          <button
            onClick={() => { if (manual.length >= 6) onCode(manual) }}
            disabled={manual.length < 6}
            className="px-4 rounded-xl bg-white/10 text-sm text-white disabled:opacity-30"
          >
            Look up
          </button>
        </div>
      </div>
    </div>
  )
}

type PortionChoice =
  | { kind: 'serving' }
  | { kind: 'package' }
  | { kind: 'half' }
  | { kind: 'custom'; grams: number | null }
  | { kind: 'photo'; grams: number }

function ServingPickerSheet({
  lookup,
  barcode,
  onClose,
  onSaved,
}: {
  lookup: Extract<BarcodeLookup, { found: true }>
  barcode: string
  onClose: () => void
  onSaved: (res: { water_logged: boolean; volume_oz: number | null }) => void
}) {
  const logManual = useLogManualFood()
  const [choice, setChoice] = useState<PortionChoice | null>(
    lookup.per_serving || lookup.serving_grams ? { kind: 'serving' } : null
  )
  const [customGrams, setCustomGrams] = useState('')
  const [customUnit, setCustomUnit] = useState<AmountUnit>('g')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoReasoning, setPhotoReasoning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [noKeyProvider, setNoKeyProvider] = useState<KeyProvider | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const servingGrams = lookup.serving_grams
  const packageGrams = lookup.package_grams

  function macrosForGrams(grams: number) {
    const f = grams / 100
    return {
      calories: Math.round(lookup.per_100g.calories * f),
      protein_g: Math.round(lookup.per_100g.protein_g * f * 10) / 10,
      carbs_g: Math.round(lookup.per_100g.carbs_g * f * 10) / 10,
    }
  }

  function currentSelection(): { macros: { calories: number; protein_g: number; carbs_g: number }; portion_desc: string } | null {
    if (!choice) return null
    switch (choice.kind) {
      case 'serving':
        if (lookup.per_serving) {
          return {
            macros: lookup.per_serving,
            portion_desc: `1 serving${lookup.serving_size ? ` (${lookup.serving_size})` : ''}`,
          }
        }
        if (servingGrams) {
          return { macros: macrosForGrams(servingGrams), portion_desc: `1 serving (${servingGrams}g)` }
        }
        return null
      case 'package':
        if (!packageGrams) return null
        return { macros: macrosForGrams(packageGrams), portion_desc: `Whole package (${packageGrams}g)` }
      case 'half':
        if (!packageGrams) return null
        return { macros: macrosForGrams(packageGrams / 2), portion_desc: `Half package (${Math.round(packageGrams / 2)}g)` }
      case 'custom': {
        const g = toGrams(Number(customGrams), customUnit)
        if (!Number.isFinite(g) || g <= 0) return null
        const desc =
          customUnit === 'g' ? `${Math.round(g)}g` : `${customGrams}${customUnit} (${Math.round(g)}g)`
        return { macros: macrosForGrams(g), portion_desc: desc }
      }
      case 'photo':
        return { macros: macrosForGrams(choice.grams), portion_desc: `~${choice.grams}g (photo est.)` }
    }
  }

  async function handlePortionPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    setError(null)
    setNoKeyProvider(null)
    try {
      const fd = new FormData()
      fd.append('photo', file)
      fd.append('product_name', `${lookup.brand ? lookup.brand + ' ' : ''}${lookup.name}`)
      fd.append('per_100g', `${lookup.per_100g.calories} kcal, ${lookup.per_100g.protein_g}g protein, ${lookup.per_100g.carbs_g}g carbs`)
      const res = await fetch('/api/health/food/portion', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        // Body is already consumed above, so re-derive the 428/no-key case
        // from the parsed json instead of calling checkNoApiKey(res) again.
        if (res.status === 428 && json?.code === 'no_api_key' && json?.provider) {
          throw new NoApiKeyClientError(json.provider)
        }
        throw new Error(json.error ?? 'Portion estimate failed')
      }
      setChoice({ kind: 'photo', grams: json.grams })
      setPhotoReasoning(json.reasoning || null)
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setNoKeyProvider(err.provider)
      else setError(String(err instanceof Error ? err.message : err))
    } finally {
      setPhotoBusy(false)
    }
  }

  async function save() {
    const sel = currentSelection()
    if (!sel) return
    setError(null)
    setNoKeyProvider(null)
    try {
      const res = await logManual.mutateAsync({
        item_name: lookup.name,
        calories: sel.macros.calories,
        protein_g: sel.macros.protein_g,
        carbs_g: sel.macros.carbs_g,
        confidence: 'high',
        notes: '',
        portion_desc: sel.portion_desc,
        volume_oz: null,
        is_hydrating: false,
        source: 'barcode',
        barcode,
        brand: lookup.brand,
      })
      onSaved({ water_logged: res.water_logged, volume_oz: null })
      onClose()
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
    }
  }

  const sel = currentSelection()

  return (
    <Sheet onClose={onClose}>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-base font-bold text-white truncate">{lookup.name}</p>
          {lookup.brand && <p className="text-xs text-zinc-500">{lookup.brand}</p>}
        </div>
        <button onClick={onClose} className="text-zinc-500 text-sm active:opacity-60 ml-3">✕</button>
      </div>

      {noKeyProvider ? <NoApiKeyNotice provider={noKeyProvider} /> : error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {(lookup.per_serving || servingGrams) && (
          <button onClick={() => setChoice({ kind: 'serving' })} className={chipClass(choice?.kind === 'serving')}>
            1 serving{lookup.serving_size ? ` (${lookup.serving_size})` : servingGrams ? ` (${servingGrams}g)` : ''}
          </button>
        )}
        {packageGrams != null && (
          <>
            <button onClick={() => setChoice({ kind: 'package' })} className={chipClass(choice?.kind === 'package')}>
              Whole package ({packageGrams}g)
            </button>
            <button onClick={() => setChoice({ kind: 'half' })} className={chipClass(choice?.kind === 'half')}>
              Half package
            </button>
          </>
        )}
        <button onClick={() => setChoice({ kind: 'custom', grams: null })} className={chipClass(choice?.kind === 'custom')}>
          Custom amount
        </button>
        <button
          onClick={() => photoInputRef.current?.click()}
          disabled={photoBusy}
          className={chipClass(choice?.kind === 'photo')}
        >
          {photoBusy ? 'Estimating…' : choice?.kind === 'photo' ? `~${choice.grams}g — photo est.` : '📷 Snap my portion'}
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handlePortionPhoto}
        />
      </div>

      {choice?.kind === 'custom' && (
        <div className="flex gap-2">
          <input
            type="number"
            inputMode="decimal"
            value={customGrams}
            onChange={e => setCustomGrams(e.target.value)}
            placeholder={customUnit}
            autoFocus
            className="min-w-0 flex-1 rounded-xl border border-white/[0.12] bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-white/30"
          />
          {/* Tap to rotate the unit: g → ml → oz → lb */}
          <button
            onClick={() => setCustomUnit(nextUnit(customUnit))}
            className="w-14 shrink-0 rounded-xl border border-white/[0.12] bg-white/[0.04] text-sm text-zinc-300 tabular-nums active:opacity-70"
          >
            {customUnit}
          </button>
        </div>
      )}

      {choice?.kind === 'photo' && photoReasoning && (
        <p className="text-[10px] text-zinc-600">{photoReasoning} — tap another option to override.</p>
      )}

      <div className="flex items-center justify-between rounded-xl bg-white/[0.04] border border-white/[0.07] px-4 py-3">
        {sel ? (
          <p className="text-sm text-white">
            <span className="font-bold">{sel.macros.calories} cal</span>
            <span className="text-zinc-400 text-xs"> · {Math.round(sel.macros.protein_g)}g P · {Math.round(sel.macros.carbs_g)}g C</span>
          </p>
        ) : (
          <p className="text-xs text-zinc-600">Pick a portion</p>
        )}
        <button
          onClick={save}
          disabled={!sel || logManual.isPending}
          className="h-10 px-6 rounded-xl text-sm font-semibold text-black disabled:opacity-40 active:opacity-80"
          style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
        >
          {logManual.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Sheet>
  )
}

export function BarcodeFlow({
  onClose,
  onTypeInstead,
  onSnapLabel,
  onSaved,
}: {
  onClose: () => void
  onTypeInstead: () => void
  onSnapLabel: () => void
  onSaved: (res: { water_logged: boolean; volume_oz: number | null }) => void
}) {
  const [stage, setStage] = useState<'scan' | 'loading' | 'picker' | 'notfound'>('scan')
  const [barcode, setBarcode] = useState('')
  const [lookup, setLookup] = useState<Extract<BarcodeLookup, { found: true }> | null>(null)

  async function handleCode(code: string) {
    setBarcode(code)
    setStage('loading')
    try {
      const res = await fetch(`/api/health/food/barcode/${code}`)
      const json: BarcodeLookup = await res.json()
      if (json.found) {
        setLookup(json)
        setStage('picker')
      } else {
        setStage('notfound')
      }
    } catch {
      setStage('notfound')
    }
  }

  if (stage === 'scan') return <BarcodeScannerOverlay onClose={onClose} onCode={handleCode} />

  if (stage === 'loading') {
    return (
      <Sheet onClose={onClose}>
        <p className="text-sm text-zinc-400 text-center py-6">Looking up product…</p>
      </Sheet>
    )
  }

  if (stage === 'picker' && lookup) {
    return <ServingPickerSheet lookup={lookup} barcode={barcode} onClose={onClose} onSaved={onSaved} />
  }

  return (
    <Sheet onClose={onClose}>
      <p className="text-base font-bold text-white">Product not found</p>
      <p className="text-xs text-zinc-500">
        Barcode {barcode} isn&apos;t in the database (or has no nutrition data). Two ways to log it anyway:
      </p>
      <div className="space-y-2">
        <button
          onClick={() => { onClose(); onSnapLabel() }}
          className="w-full h-12 rounded-xl text-sm font-semibold text-black active:opacity-80"
          style={{ background: 'linear-gradient(180deg,#ffffff 0%,#e8e5dd 100%)' }}
        >
          📷 Snap the nutrition label
        </button>
        <button
          onClick={() => { onClose(); onTypeInstead() }}
          className="w-full h-12 rounded-xl bg-white/[0.06] border border-white/[0.08] text-sm font-semibold text-zinc-300 active:opacity-80"
        >
          Type it instead
        </button>
      </div>
    </Sheet>
  )
}

// ─── Frequents row ───────────────────────────────────────────────────────────

export function FrequentsRow({
  onSaved,
}: {
  onSaved: (res: { water_logged: boolean; volume_oz: number | null }) => void
}) {
  const { data: items } = useFoodItems()
  const logManual = useLogManualFood()
  const [loggingId, setLoggingId] = useState<string | null>(null)

  if (!items || items.length === 0) return null

  async function relog(item: FoodItem) {
    if (logManual.isPending) return
    setLoggingId(item.id)
    try {
      const res = await logManual.mutateAsync({
        item_name: item.name,
        calories: item.calories,
        protein_g: Number(item.protein_g),
        carbs_g: Number(item.carbs_g),
        confidence: 'medium',
        notes: '',
        portion_desc: item.portion_desc,
        volume_oz: item.volume_oz != null ? Number(item.volume_oz) : null,
        is_hydrating: item.is_hydrating,
        source: item.source,
        barcode: item.barcode,
        brand: item.brand,
      })
      onSaved({ water_logged: res.water_logged, volume_oz: item.volume_oz != null ? Number(item.volume_oz) : null })
    } catch {
      // row stays; next tap retries
    } finally {
      setLoggingId(null)
    }
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <div className="flex gap-2 px-1 pb-1 w-max">
        {items.map(item => (
          <button
            key={item.id}
            onClick={() => relog(item)}
            disabled={logManual.isPending}
            className="shrink-0 rounded-xl border border-white/[0.10] bg-white/[0.03] px-3 py-2 text-left active:opacity-70 disabled:opacity-50"
          >
            <p className="text-xs font-semibold text-white whitespace-nowrap max-w-[140px] truncate">
              {loggingId === item.id ? 'Logging…' : item.name}
            </p>
            <p className="text-[10px] text-zinc-500 whitespace-nowrap">
              {item.calories} cal · {item.portion_desc.length > 18 ? item.portion_desc.slice(0, 18) + '…' : item.portion_desc}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
