'use client'

import { useState, useRef, useCallback } from 'react'
import { useDebloatLog, useDebloatHistory } from '@/features/debloat/queries'
import { useUpsertDebloatLog } from '@/features/debloat/mutations'
import { CHECKLIST_ITEMS, BLOAT_LEVELS, GUIDE_SECTIONS } from '@/features/debloat/types'

const BLOAT_COLORS: Record<number, string> = {
  1: '#4ade80',
  2: '#a3e635',
  3: '#facc15',
  4: '#fb923c',
  5: '#f87171',
}

function getLast7Days(today: string): string[] {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today + 'T12:00:00')
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

export default function DebloatSection({ today }: { today: string }) {
  const { data: todayLog } = useDebloatLog(today)
  const { data: history = [] } = useDebloatHistory()
  const upsert = useUpsertDebloatLog()

  const [localBloat, setLocalBloat] = useState<number | null>(null)
  const [localChecklist, setLocalChecklist] = useState<Record<string, boolean>>({})
  const [initialized, setInitialized] = useState(false)

  if (todayLog !== undefined && !initialized) {
    setLocalBloat(todayLog?.bloat_level ?? null)
    setLocalChecklist(todayLog?.checklist ?? {})
    setInitialized(true)
  }

  const [openGuide, setOpenGuide] = useState<number | null>(null)
  const [analyzeText, setAnalyzeText] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const last7 = getLast7Days(today)
  const historyMap = Object.fromEntries(history.map(l => [l.date, l]))

  function setBloatLevel(level: number) {
    const next = localBloat === level ? null : level
    setLocalBloat(next)
    upsert.mutate({ date: today, bloat_level: next, checklist: localChecklist })
  }

  function toggleChecklist(key: string) {
    const next = { ...localChecklist, [key]: !localChecklist[key] }
    setLocalChecklist(next)
    upsert.mutate({ date: today, bloat_level: localBloat, checklist: next })
  }

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    setAnalyzeText('')
    setAnalyzing(true)

    try {
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })

      const res = await fetch('/api/debloat/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
      })

      if (!res.ok || !res.body) { setAnalyzeText('Something went wrong. Try again.'); return }

      const streamReader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { value, done } = await streamReader.read()
        if (done) break
        setAnalyzeText(prev => prev + decoder.decode(value))
      }
    } finally {
      setAnalyzing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }, [])

  const checkedCount = CHECKLIST_ITEMS.filter(i => localChecklist[i.key]).length

  return (
    <div className="space-y-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 px-1">Debloat</p>

      {/* Bloat Level */}
      <section className="rounded-2xl bg-zinc-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
          How bloated do you feel today?
        </p>
        <div className="flex gap-2 mb-5">
          {BLOAT_LEVELS.map(({ level, emoji, label }) => (
            <button
              key={level}
              onClick={() => setBloatLevel(level)}
              className={`flex-1 flex flex-col items-center gap-1 rounded-xl py-3 transition-all active:scale-95 ${
                localBloat === level ? 'bg-zinc-700 ring-1 ring-white/20' : 'bg-zinc-800 active:bg-zinc-700'
              }`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="text-[10px] text-zinc-400">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-1.5">
          {last7.map(day => {
            const log = historyMap[day]
            const level = day === today ? localBloat : (log?.bloat_level ?? null)
            const isToday = day === today
            return (
              <div key={day} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-full transition-all"
                  style={{
                    height: level ? 6 + level * 5 : 4,
                    backgroundColor: level ? BLOAT_COLORS[level] : '#27272a',
                    opacity: isToday ? 1 : 0.7,
                  }}
                />
                <span className="text-[9px] text-zinc-600">
                  {new Date(day + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Daily Checklist */}
      <section className="rounded-2xl bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Today&apos;s Checklist</p>
          <span className="text-xs font-bold text-zinc-400">{checkedCount}/{CHECKLIST_ITEMS.length}</span>
        </div>
        <div className="flex flex-col gap-2">
          {CHECKLIST_ITEMS.map(({ key, label, emoji }) => {
            const checked = !!localChecklist[key]
            return (
              <button
                key={key}
                onClick={() => toggleChecklist(key)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors active:opacity-70 ${
                  checked ? 'bg-zinc-800' : 'bg-zinc-800/50'
                }`}
              >
                <div className={`h-5 w-5 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-colors ${
                  checked ? 'border-white bg-white' : 'border-zinc-600'
                }`}>
                  {checked && (
                    <svg viewBox="0 0 10 8" fill="none" className="h-2.5 w-2.5">
                      <path d="M1 4l3 3 5-6" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className="text-sm">{emoji} {label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* AI Analyze */}
      <section className="rounded-2xl bg-zinc-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">Analyze my face</p>
        <p className="text-xs text-zinc-600 mb-4">Take a selfie and get feedback on facial puffiness and what to do</p>

        <input ref={fileInputRef} type="file" accept="image/*" capture="user" onChange={handleFileChange} className="hidden" />

        {previewUrl && (
          <div className="mb-4 rounded-xl overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="Face preview" className="w-full max-h-48 object-cover" />
          </div>
        )}

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={analyzing}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-zinc-800 text-sm font-medium text-zinc-300 disabled:opacity-50 active:opacity-70"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {analyzing ? 'Analyzing…' : previewUrl ? 'Take another selfie' : 'Take a selfie'}
        </button>

        {analyzeText && <p className="mt-4 text-sm leading-relaxed text-zinc-300">{analyzeText}</p>}
      </section>

      {/* Guide */}
      <div className="pb-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-3 px-1">Guide</p>
        <div className="flex flex-col gap-2">
          {GUIDE_SECTIONS.map((section, i) => (
            <div key={i} className="rounded-2xl bg-zinc-900 overflow-hidden">
              <button
                onClick={() => setOpenGuide(openGuide === i ? null : i)}
                className="flex w-full items-center justify-between px-5 py-4 text-left active:opacity-70"
              >
                <span className="font-semibold text-white">{section.emoji} {section.title}</span>
                <span className={`text-zinc-500 transition-transform duration-200 ${openGuide === i ? 'rotate-180' : ''}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </span>
              </button>
              {openGuide === i && (
                <div className="px-5 pb-5 flex flex-col gap-3 border-t border-zinc-800">
                  {section.items.map((item, j) => (
                    <p key={j} className="text-sm text-zinc-400 leading-relaxed pt-3">{item}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
