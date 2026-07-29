'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRefinePhotoMeal, useFavoriteFoodLog, useDeleteFoodLog, useUpdateFoodLog } from '@/features/food/mutations'
import { checkNoApiKey, noApiKeyMessage, NoApiKeyClientError, AiLimitClientError, type KeyProvider } from '@/lib/apiKeyError'
import NoApiKeyNotice from '@/components/NoApiKeyNotice'
import AiLimitNotice from '@/components/AiLimitNotice'
import type { FoodLog, PhotoRefineQuestion, PhotoRefineAnswer } from '@/features/food/types'
import { foodEmoji } from '@/features/food/foodEmoji'

type AiRaw = {
  refine?: {
    questions: PhotoRefineQuestion[]
    answers: PhotoRefineAnswer[]
  }
}

function getRefineData(meal: FoodLog) {
  const raw = (meal.ai_raw ?? {}) as AiRaw
  return raw.refine ?? { questions: [], answers: [] }
}

const chipBase = 'rounded-xl border px-3 py-2.5 text-sm text-left transition-colors'
const chipIdle = 'border-white/[0.12] bg-white/[0.03] text-zinc-300 active:opacity-70'
const chipAnswered = 'border-white/[0.06] bg-white/[0.02] text-zinc-600'
const chipAnsweredSelected = 'border-emerald-300/30 bg-emerald-300/[0.06] text-zinc-400'

// `meal` is rendered straight from the prop — never copied into local state.
// A local snapshot froze the row: editing calories/macros in the edit sheet
// patched the food-logs cache, but this card kept showing the old numbers
// until a navigation remounted it. Every mutation here (refine, note, edit)
// writes the authoritative row back into the cache, so the prop is the truth.
export function PhotoMealCard({
  meal,
  today,
  onEdit,
  isNew = false,
}: {
  meal: FoodLog
  today: string
  onEdit: () => void
  isNew?: boolean
}) {
  const refineData = getRefineData(meal)
  const isOpen = meal.refine_status === 'open'

  const [expanded, setExpanded] = useState(isOpen || isNew)
  const [questions, setQuestions] = useState<PhotoRefineQuestion[]>(refineData.questions)
  const [answers, setAnswers] = useState<PhotoRefineAnswer[]>(refineData.answers)
  const [submitting, setSubmitting] = useState(false)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [done, setDone] = useState(!isOpen)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState(meal.notes ?? '')
  const [favorited, setFavorited] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [coachFeedback, setCoachFeedback] = useState(meal.coach_feedback ?? '')
  const [coachStreaming, setCoachStreaming] = useState(false)
  const [refineNoKeyProvider, setRefineNoKeyProvider] = useState<KeyProvider | null>(null)
  const [refineAiLimit, setRefineAiLimit] = useState(false)
  const coachFired = useRef(false)

  const refine = useRefinePhotoMeal()
  const favorite = useFavoriteFoodLog()
  const deleteMeal = useDeleteFoodLog()
  const updateMeal = useUpdateFoodLog()

  const streamCoachFeedback = useCallback(async (mealId: string) => {
    if (coachFired.current) return
    coachFired.current = true
    setCoachStreaming(true)
    setCoachFeedback('')
    try {
      const res = await fetch(`/api/health/food/${mealId}/coach`, { method: 'POST' })
      if (!res.ok || !res.body) {
        const noKey = await checkNoApiKey(res)
        if (noKey) setCoachFeedback(noApiKeyMessage(noKey.provider))
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done: rdone, value } = await reader.read()
        if (rdone) break
        setCoachFeedback(prev => prev + decoder.decode(value))
      }
    } catch (err) {
      console.error('[PhotoMealCard] coach error:', err)
    } finally {
      setCoachStreaming(false)
    }
  }, [])

  // Auto-fire coach feedback if this is a new meal and already done (no refine questions)
  useEffect(() => {
    if (isNew && !isOpen && !meal.coach_feedback && !coachFired.current) {
      streamCoachFeedback(meal.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentQuestionIndex = answers.length
  const currentQuestion = !done && questions[currentQuestionIndex]

  const handleAnswer = useCallback(async (answer: string) => {
    if (submitting || !currentQuestion) return
    setSubmitting(true)
    setOtherOpen(false)
    setOtherText('')
    setRefineNoKeyProvider(null)
    setRefineAiLimit(false)

    try {
      const result = await refine.mutateAsync({
        id: meal.id,
        date: today,
        question: currentQuestion.question,
        answer,
      })

      if (result.status === 'question') {
        setAnswers(prev => [...prev, { question: currentQuestion.question, answer }])
        setQuestions(prev => [...prev, result.question])
      } else {
        // The mutation's onSuccess writes the refined macros into the
        // food-logs cache, which flows back down as `meal`.
        setAnswers(prev => [...prev, { question: currentQuestion.question, answer }])
        setDone(true)
        // Fire coach feedback now that refine is complete
        streamCoachFeedback(meal.id)
      }
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setRefineNoKeyProvider(err.provider)
      else if (err instanceof AiLimitClientError) setRefineAiLimit(true)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, currentQuestion, refine, meal.id, today, streamCoachFeedback])

  const handleSkip = useCallback(async () => {
    await handleAnswer('[skipped]')
  }, [handleAnswer])

  const handleFavorite = async () => {
    try {
      const result = await favorite.mutateAsync({ id: meal.id })
      setFavorited(result.favorited)
    } catch {
      // silent
    }
  }

  const handleReAnswer = useCallback(async (questionIndex: number, opt: string) => {
    const q = questions[questionIndex]
    if (!q || submitting) return
    setAnswers(prev => prev.slice(0, questionIndex))
    setQuestions(prev => prev.slice(0, questionIndex + 1))
    setDone(false)
    setSubmitting(true)
    setRefineNoKeyProvider(null)
    setRefineAiLimit(false)
    try {
      const result = await refine.mutateAsync({
        id: meal.id,
        date: today,
        question: q.question,
        answer: opt,
        rewindTo: questionIndex,
      })
      if (result.status === 'question') {
        setAnswers(prev => [...prev, { question: q.question, answer: opt }])
        setQuestions(prev => [...prev, result.question])
      } else {
        setAnswers(prev => [...prev, { question: q.question, answer: opt }])
        setDone(true)
        coachFired.current = false
        streamCoachFeedback(meal.id)
      }
    } catch (err) {
      if (err instanceof NoApiKeyClientError) setRefineNoKeyProvider(err.provider)
      else if (err instanceof AiLimitClientError) setRefineAiLimit(true)
    } finally {
      setSubmitting(false)
    }
  }, [submitting, questions, refine, meal.id, today, streamCoachFeedback])

  const handleSaveNote = async () => {
    try {
      await updateMeal.mutateAsync({
        id: meal.id,
        date: today,
        updates: { notes: noteText.trim() || null },
      })
      setNoteOpen(false)
    } catch {
      // silent
    }
  }

  const handleDelete = async () => {
    try {
      await deleteMeal.mutateAsync({ id: meal.id, date: today })
    } catch {
      setConfirmDelete(false)
    }
  }

  const showEstimateBadge = !done

  return (
    <div className="rounded-[10px] bg-white/[0.035] overflow-hidden">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        {meal.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meal.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="h-10 w-10 shrink-0 rounded-lg bg-white/[0.05] flex items-center justify-center text-lg leading-none">
            {foodEmoji(meal.item_name, { source: meal.source, override: meal.emoji })}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{meal.item_name}</p>
            {showEstimateBadge && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-300 border border-emerald-300/30">
                ESTIMATE
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500">
            {Math.round(Number(meal.protein_g))}g P
            {' · '}
            {Math.round(Number(meal.carbs_g))}g C
            {meal.fat_g != null ? ` · ${Math.round(Number(meal.fat_g))}g F` : ''}
            {meal.taken_at ? ` · ${new Date(meal.taken_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-bold text-[#6ee7b7]">{meal.calories?.toLocaleString()} cal</span>
          <svg
            className={`h-4 w-4 text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Coach feedback (always visible when present, even collapsed) */}
      {(coachFeedback || coachStreaming) && (
        <p className="px-3 pb-2.5 text-xs italic text-zinc-400 leading-relaxed border-t border-white/[0.05] pt-2">
          {coachFeedback || '…'}
        </p>
      )}

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Refine questions */}
          {(questions.length > 0 || !done) && (
            <div className="border-l-2 border-[#6ee7b7] pl-3 space-y-4">
              {questions.map((q, i) => {
                const isAnswered = i < answers.length
                const isActive = i === currentQuestionIndex && !done
                const selectedAnswer = answers[i]?.answer

                if (i > currentQuestionIndex) return null

                return (
                  <div key={i} className="space-y-2">
                    <p className="text-xs italic text-zinc-400 leading-relaxed">
                      {q.reasoning}
                      {q.calorie_delta != null ? ` (±${q.calorie_delta} kcal)` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {q.options.map(opt => {
                        if (isAnswered) {
                          const isSelected = selectedAnswer === opt
                          return (
                            <button
                              key={opt}
                              disabled={submitting}
                              onClick={() => { if (opt !== selectedAnswer) handleReAnswer(i, opt) }}
                              className={`${chipBase} ${isSelected ? chipAnsweredSelected : chipAnswered} disabled:opacity-50`}
                            >
                              {opt}
                            </button>
                          )
                        }
                        return (
                          <button
                            key={opt}
                            disabled={submitting}
                            onClick={() => handleAnswer(opt)}
                            className={`${chipBase} ${chipIdle} disabled:opacity-50`}
                          >
                            {opt}
                          </button>
                        )
                      })}
                      {isActive && !otherOpen && (
                        <button
                          disabled={submitting}
                          onClick={() => setOtherOpen(true)}
                          className={`${chipBase} ${chipIdle} disabled:opacity-50`}
                        >
                          Something else
                        </button>
                      )}
                    </div>
                    {isActive && otherOpen && (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={otherText}
                          onChange={e => setOtherText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && otherText.trim()) handleAnswer(otherText.trim())
                          }}
                          placeholder="Describe it…"
                          className="flex-1 rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
                        />
                        <button
                          disabled={!otherText.trim() || submitting}
                          onClick={() => otherText.trim() && handleAnswer(otherText.trim())}
                          className="rounded-[10px] border border-white/[0.12] bg-white/[0.04] px-3 py-2 text-xs font-semibold text-zinc-300 disabled:opacity-40"
                        >
                          OK
                        </button>
                      </div>
                    )}
                    {isActive && (
                      <button
                        onClick={handleSkip}
                        disabled={submitting}
                        className="text-xs text-zinc-600 disabled:opacity-40"
                      >
                        Don&apos;t know · skip
                      </button>
                    )}
                  </div>
                )
              })}
              {submitting && (
                <p className="text-xs text-zinc-500">Refining estimate…</p>
              )}
              {done && questions.length > 0 && (
                <p className="text-xs text-zinc-500">Estimate refined ✓</p>
              )}
              {refineNoKeyProvider && <NoApiKeyNotice provider={refineNoKeyProvider} />}
              {refineAiLimit && <AiLimitNotice />}
            </div>
          )}

          {/* Footer actions */}
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Delete this meal?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded-lg bg-red-500/20 px-3 py-1.5 text-xs font-medium text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 pt-0.5">
              <button
                onClick={e => { e.stopPropagation(); setNoteOpen(n => !n) }}
                className="text-xs text-zinc-500 active:opacity-70"
              >
                + {meal.notes && !noteOpen ? 'edit note' : 'add a note'}
              </button>
              <button
                onClick={handleFavorite}
                disabled={favorite.isPending}
                className={`text-xs transition-colors disabled:opacity-40 ${favorited ? 'text-yellow-400' : 'text-zinc-500'}`}
              >
                {favorited ? '⭐ saved' : '☆ favorite'}
              </button>
              <button
                onClick={onEdit}
                className="text-xs text-zinc-500 active:opacity-70"
              >
                edit
              </button>
              <button
                onClick={() => setConfirmDelete(true)}
                className="ml-auto text-xs text-zinc-600 hover:text-red-400 transition-colors"
              >
                ×
              </button>
            </div>
          )}

          {noteOpen && (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Add a note about this meal…"
                rows={2}
                className="w-full rounded-[10px] border border-white/[0.12] bg-black/25 px-3 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setNoteOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.12] py-2 text-xs font-semibold text-zinc-400"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveNote}
                  disabled={updateMeal.isPending}
                  className="flex-1 rounded-xl py-2 text-xs font-bold text-[#0a0a0b] disabled:opacity-40"
                  style={{ background: 'linear-gradient(180deg, #fff 0%, #e8e5dd 100%)' }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
