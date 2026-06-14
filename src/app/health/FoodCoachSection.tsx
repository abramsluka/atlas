'use client'

import { useState, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFoodCoachMessages } from '@/features/food/queries'
import { useStickToBottom } from '@/lib/useStickToBottom'
import type { FoodLog } from '@/features/food/types'

const CHIPS = [
  'enough protein today?',
  'what should I eat tonight?',
  'how am I tracking?',
  'how many more calories?',
]

interface Props {
  today: string
  meals: FoodLog[]
  profile: {
    daily_calorie_target?: number | null
    daily_protein_target_g?: number | null
    daily_carbs_target_g?: number | null
  } | null | undefined
}

export function FoodCoachSection({ today, meals, profile }: Props) {
  const qc = useQueryClient()
  const { data: messages } = useFoodCoachMessages(today)

  const summaryMsg = messages?.find(m => m.is_summary)
  const threadMessages = messages?.filter(m => !m.is_summary) ?? []

  const [summaryStream, setSummaryStream] = useState('')
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [askStream, setAskStream] = useState('')
  const [asking, setAsking] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [inputText, setInputText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const { scrollToBottom, stuck } = useStickToBottom()

  const generateSummary = useCallback(async () => {
    if (summaryGenerating) return
    setSummaryGenerating(true)
    setSummaryStream('')
    try {
      const res = await fetch('/api/health/food/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today }),
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setSummaryStream(prev => prev + decoder.decode(value))
      }
      await qc.invalidateQueries({ queryKey: ['food-coach', today] })
      setSummaryStream('')
    } catch (err) {
      console.error('[FoodCoachSection] summary error:', err)
    } finally {
      setSummaryGenerating(false)
    }
  }, [summaryGenerating, today, qc])

  const ask = useCallback(async (question: string, chipLabel?: string) => {
    if (asking || !question.trim()) return
    setAsking(true)
    setAskStream('')
    setPendingQuestion(question)
    setInputText('')
    stuck.current = true // user initiated — resume following
    setTimeout(() => threadEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    try {
      const res = await fetch('/api/health/food/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: today, question, chip_label: chipLabel ?? null }),
      })
      if (!res.ok || !res.body) return
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        setAskStream(prev => prev + decoder.decode(value))
        scrollToBottom(threadEndRef.current)
      }
      await qc.invalidateQueries({ queryKey: ['food-coach', today] })
      setAskStream('')
      setPendingQuestion(null)
    } catch (err) {
      console.error('[FoodCoachSection] ask error:', err)
    } finally {
      setAsking(false)
    }
  }, [asking, today, qc])

  const hasMeals = meals.length > 0

  return (
    <div className="space-y-4 pt-1 border-t border-white/[0.06]">
      {/* TODAY'S FUEL */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600 mb-2 mt-3">
          Today&apos;s Fuel
        </p>
        <div className="rounded-[10px] bg-white/[0.025] border border-white/[0.06] px-3 py-3 min-h-[48px]">
          {!hasMeals ? (
            <p className="text-xs italic text-zinc-600">Log a meal and I will take a look.</p>
          ) : summaryGenerating ? (
            <p className="text-xs text-zinc-300 leading-relaxed">{summaryStream || <span className="text-zinc-600">…</span>}</p>
          ) : summaryMsg ? (
            <div className="flex items-start gap-2">
              <p className="flex-1 text-xs text-zinc-300 leading-relaxed">{summaryMsg.content}</p>
              <button
                onClick={generateSummary}
                className="shrink-0 mt-0.5 text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Refresh"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0 1 14.1-3.1M20 15a9 9 0 0 1-14.1 3.1" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={generateSummary}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Get today&apos;s fuel breakdown →
            </button>
          )}
        </div>
      </div>

      {/* ASK YOUR COACH */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600 mb-2">
          Ask Your Coach
        </p>

        {/* Thread */}
        {(threadMessages.length > 0 || pendingQuestion) && (
          <div className="space-y-2 mb-3">
            {threadMessages.map(msg => (
              <div key={msg.id} className={msg.role === 'user' ? 'flex justify-end' : ''}>
                <p
                  className={
                    msg.role === 'user'
                      ? 'inline-block max-w-[82%] rounded-2xl bg-white/[0.07] px-3 py-2 text-xs text-zinc-300'
                      : 'text-xs text-zinc-300 leading-relaxed pr-2'
                  }
                >
                  {msg.content}
                </p>
              </div>
            ))}
            {pendingQuestion && (
              <div className="flex justify-end">
                <p className="inline-block max-w-[82%] rounded-2xl bg-white/[0.07] px-3 py-2 text-xs text-zinc-300">
                  {pendingQuestion}
                </p>
              </div>
            )}
            {(asking || askStream) && (
              <p className="text-xs text-zinc-300 leading-relaxed pr-2">
                {askStream || <span className="text-zinc-600">…</span>}
              </p>
            )}
            <div ref={threadEndRef} />
          </div>
        )}

        {/* Chips */}
        <div className="flex flex-wrap gap-1.5 mb-2">
          {CHIPS.map(chip => (
            <button
              key={chip}
              disabled={asking}
              onClick={() => ask(chip, chip)}
              className="rounded-xl border border-white/[0.12] bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition-colors active:opacity-70 disabled:opacity-40"
            >
              {chip}
            </button>
          ))}
        </div>

        {/* Free text input */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && inputText.trim()) {
                e.preventDefault()
                ask(inputText.trim())
              }
            }}
            placeholder="Ask your coach…"
            disabled={asking}
            className="flex-1 rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40 disabled:opacity-50"
          />
          <button
            disabled={!inputText.trim() || asking}
            onClick={() => ask(inputText.trim())}
            className="rounded-[10px] border border-white/[0.12] bg-white/[0.04] px-3 py-2.5 text-sm font-semibold text-zinc-300 disabled:opacity-40 transition-colors"
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  )
}
