'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useHabits } from '@/features/habits/queries'
import { useToggleHabit } from '@/features/habits/mutations'
import type { HabitDay, HabitView } from '@/features/habits/types'

const GREEN = '#4ade80'
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// ─── Day dot ──────────────────────────────────────────────────────────────────

function DayDot({ day, onToggle }: { day: HabitDay; onToggle: () => void }) {
  const { done, today, future } = day

  return (
    <div className="flex justify-center">
      <motion.button
        onClick={onToggle}
        disabled={future}
        whileTap={future ? undefined : { scale: 0.85 }}
        transition={{ duration: 0.12 }}
        aria-label={day.date + (done ? ' done' : ' not done')}
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{
          border: today ? `1px solid rgba(74,222,128,0.5)` : '1px solid transparent',
          cursor: future ? 'default' : 'pointer',
          opacity: future ? 0.28 : 1,
        }}
      >
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-full"
          style={
            done
              ? { background: GREEN, boxShadow: '0 0 8px rgba(74,222,128,0.55)' }
              : { border: '1.5px solid rgba(255,255,255,0.18)' }
          }
        >
          {done && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#05130a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
          )}
        </span>
      </motion.button>
    </div>
  )
}

// ─── Habit row ────────────────────────────────────────────────────────────────

function HabitRow({ habit, index, onToggle }: { habit: HabitView; index: number; onToggle: (date: string, completed: boolean) => void }) {
  const hitTarget = habit.weeklyDone >= habit.perWeek

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: 'easeOut', delay: Math.min(index * 0.03, 0.3) }}
      className="cosmic-card px-4 py-3.5"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg text-[17px]" style={{ background: 'rgba(255,255,255,0.04)' }}>
            {habit.emoji}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold text-white">{habit.name}</span>
              {habit.kind === 'auto' && (
                <span className="flex-none rounded-full px-1.5 py-px text-[8.5px] font-bold uppercase tracking-[0.12em]" style={{ color: GREEN, background: 'rgba(74,222,128,0.12)' }}>
                  auto
                </span>
              )}
            </div>
            {habit.streakWeeks > 0 && (
              <div className="mt-0.5 text-[11px] font-medium text-zinc-500">
                🔥 {habit.streakWeeks} week{habit.streakWeeks > 1 ? 's' : ''} on target
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-none items-baseline gap-0.5 tabular-nums">
          <span className="text-[15px] font-bold" style={{ color: hitTarget ? GREEN : 'rgba(255,255,255,0.85)' }}>{habit.weeklyDone}</span>
          <span className="text-[12px] font-semibold text-zinc-600">/{habit.perWeek}</span>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {habit.week.map((day) => (
          <DayDot key={day.date} day={day} onToggle={() => onToggle(day.date, !day.done)} />
        ))}
      </div>
    </motion.div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HabitsClient({ initial }: { initial: HabitView[] }) {
  const router = useRouter()
  const { data: habits = [] } = useHabits(initial)
  const toggle = useToggleHabit()

  const todayDone = habits.filter((h) => h.week.find((d) => d.today)?.done).length
  const weekPct = habits.length
    ? Math.round((habits.reduce((s, h) => s + Math.min(1, h.perWeek ? h.weeklyDone / h.perWeek : 0), 0) / habits.length) * 100)
    : 0

  return (
    <main className="min-h-screen px-5 pb-28 pt-14" style={{ background: 'radial-gradient(ellipse 55% 40% at 50% 0%, rgba(74,222,128,0.05), transparent 70%)' }}>
      {/* header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <motion.button
            onClick={() => router.push('/')}
            whileTap={{ scale: 0.9 }}
            className="mb-3 flex h-9 w-9 items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            aria-label="Back to home"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </motion.button>
          <h1 className="text-3xl font-bold tracking-tight text-white">Habits</h1>
          <p className="mt-0.5 text-xs text-zinc-600">manual streaks · weekly targets</p>
        </div>

        <div className="flex gap-2.5">
          <StatTile label="Today" value={`${todayDone}/${habits.length}`} />
          <StatTile label="This week" value={`${weekPct}%`} accent />
        </div>
      </div>

      {/* weekday legend, aligned to the dot grid inside each card (px-4) */}
      <div className="mb-2 grid grid-cols-7 gap-1 px-4">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="text-center text-[9px] font-bold uppercase tracking-widest text-zinc-700">{d}</span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {habits.map((habit, i) => (
          <HabitRow
            key={habit.id}
            habit={habit}
            index={i}
            onToggle={(date, completed) => toggle.mutate({ id: habit.id, date, completed })}
          />
        ))}
      </div>
    </main>
  )
}

function StatTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="cosmic-card px-3.5 py-2 text-center">
      <div className="text-[16px] font-bold leading-none tabular-nums" style={{ color: accent ? GREEN : '#fff' }}>{value}</div>
      <div className="mt-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-zinc-600">{label}</div>
    </div>
  )
}
