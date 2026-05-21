'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTodayCheckin } from '@/features/workouts/queries'
import { useSaveMorningCheckin, useSaveEveningCheckin } from '@/features/workouts/mutations'
import type { DailyCheckin } from '@/features/workouts/types'

interface Props {
  today: string
  initialCheckin: DailyCheckin | null
}

export default function HomeClient({ today, initialCheckin }: Props) {
  const queryClient = useQueryClient()

  if (initialCheckin) {
    queryClient.setQueryData(['checkin', today], initialCheckin)
  }

  const { data: checkin } = useTodayCheckin(today)
  const hour = new Date().getHours()
  const isMorning = hour < 14

  return (
    <main className="flex min-h-screen flex-col px-6 pb-10 pt-14">
      <h1 className="mb-10 text-4xl font-bold tracking-tight">Atlas</h1>

      <section className="mb-10">
        {isMorning ? (
          <MorningCheckin today={today} checkin={checkin ?? null} />
        ) : (
          <EveningCheckin today={today} checkin={checkin ?? null} />
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
          Training
        </h2>
        <Link
          href="/workouts/new"
          className="flex h-14 w-full items-center justify-center rounded-xl bg-white text-base font-semibold text-black active:opacity-80"
        >
          Log a workout
        </Link>
        <Link
          href="/workouts"
          className="mt-3 flex h-14 w-full items-center justify-center rounded-xl bg-zinc-900 text-base font-medium text-white active:opacity-80"
        >
          Workout history
        </Link>
      </section>
    </main>
  )
}

function MorningCheckin({ today, checkin }: { today: string; checkin: DailyCheckin | null }) {
  const [intent, setIntent] = useState('')
  const mutation = useSaveMorningCheckin(today)

  if (checkin?.morning_planned_training !== null && checkin?.morning_planned_training !== undefined) {
    return (
      <div className="rounded-xl bg-zinc-900 px-5 py-5">
        <p className="text-sm text-zinc-400">Morning check-in</p>
        <p className="mt-1 text-lg font-semibold">
          {checkin.morning_planned_training ? '✓ Training planned' : '✓ Rest day'}
        </p>
        {checkin.morning_intent && (
          <p className="mt-1 text-sm text-zinc-400">{checkin.morning_intent}</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-zinc-900 px-5 py-5">
      <p className="mb-4 text-lg font-semibold">Training today?</p>
      <textarea
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        placeholder="What's the plan? (optional)"
        rows={2}
        className="mb-4 w-full resize-none rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none"
      />
      <div className="flex gap-3">
        <button
          onClick={() => mutation.mutate({ planned: true, intent: intent || undefined })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white text-base font-semibold text-black disabled:opacity-50 active:opacity-80"
        >
          Yes
        </button>
        <button
          onClick={() => mutation.mutate({ planned: false })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-base font-semibold text-white disabled:opacity-50 active:opacity-80"
        >
          No
        </button>
      </div>
      {mutation.error && (
        <p className="mt-2 text-sm text-red-400">{String(mutation.error)}</p>
      )}
    </div>
  )
}

function EveningCheckin({ today, checkin }: { today: string; checkin: DailyCheckin | null }) {
  const [reflection, setReflection] = useState('')
  const mutation = useSaveEveningCheckin(today)

  if (checkin?.evening_actual_training !== null && checkin?.evening_actual_training !== undefined) {
    return (
      <div className="rounded-xl bg-zinc-900 px-5 py-5">
        <p className="text-sm text-zinc-400">Evening check-in</p>
        <p className="mt-1 text-lg font-semibold">
          {checkin.evening_actual_training ? '✓ Trained today' : '✓ Rest day'}
        </p>
        {checkin.evening_reflection && (
          <p className="mt-1 text-sm text-zinc-400">{checkin.evening_reflection}</p>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-zinc-900 px-5 py-5">
      <p className="mb-4 text-lg font-semibold">Did you train?</p>
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        placeholder="How'd it go? (optional)"
        rows={2}
        className="mb-4 w-full resize-none rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none"
      />
      <div className="flex gap-3">
        <button
          onClick={() => mutation.mutate({ trained: true, reflection: reflection || undefined })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-white text-base font-semibold text-black disabled:opacity-50 active:opacity-80"
        >
          Yes
        </button>
        <button
          onClick={() => mutation.mutate({ trained: false })}
          disabled={mutation.isPending}
          className="flex h-12 flex-1 items-center justify-center rounded-xl bg-zinc-800 text-base font-semibold text-white disabled:opacity-50 active:opacity-80"
        >
          No
        </button>
      </div>
      {mutation.error && (
        <p className="mt-2 text-sm text-red-400">{String(mutation.error)}</p>
      )}
    </div>
  )
}
