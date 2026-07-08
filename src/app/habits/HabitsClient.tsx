'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { useHabits, useHabitHistory } from '@/features/habits/queries'
import { useToggleHabit, useUpdateGoal, useLogAll } from '@/features/habits/mutations'
import type { HabitView, HabitHistoryWeek } from '@/features/habits/types'

const GREEN = '#4ade80'
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// YYYY-MM-DD → "Jul 6" (UTC getters avoid tz drift on a date-only string)
function fmtMD(d: string) {
  const dt = new Date(d + 'T00:00:00Z')
  return `${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}`
}

const tickSvg = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#05130a" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)

// ─── Big daily check ────────────────────────────────────────────────────────

function BigCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      whileTap={{ scale: 0.86 }}
      transition={{ duration: 0.12 }}
      aria-label={done ? 'Logged today' : 'Log today'}
      className="relative grid h-[46px] w-[46px] flex-none place-items-center rounded-full"
      style={{
        border: done ? '2px solid transparent' : '2px solid rgba(255,255,255,0.16)',
        background: done ? 'radial-gradient(circle at 50% 35%, #5df08e, #3ecb74)' : 'transparent',
        boxShadow: done ? '0 0 16px -2px rgba(74,222,128,0.5), inset 0 1px 1px rgba(255,255,255,0.4)' : 'none',
        transition: 'background .2s, border-color .2s, box-shadow .2s',
      }}
    >
      <motion.span animate={{ scale: done ? 1 : 0.3, opacity: done ? 1 : 0 }} transition={{ duration: 0.22, ease: [0.2, 1.5, 0.4, 1] }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#05130a" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      </motion.span>
    </motion.button>
  )
}

// ─── Small week dot (expand detail + week grid) ─────────────────────────────

function WeekDot({ day, onToggle }: { day: { done: boolean; today: boolean; future: boolean }; onToggle: () => void }) {
  return (
    <motion.button
      onClick={day.future ? undefined : onToggle}
      whileTap={day.future ? undefined : { scale: 0.85 }}
      disabled={day.future}
      className="grid h-[26px] w-[26px] place-items-center rounded-full"
      style={{
        border: day.done ? '1.5px solid transparent' : '1.5px solid rgba(255,255,255,0.16)',
        background: day.done ? GREEN : 'transparent',
        boxShadow: day.done ? '0 0 8px -1px rgba(74,222,128,0.5)' : (day.today ? '0 0 0 2px rgba(74,222,128,0.4)' : 'none'),
        opacity: day.future ? 0.28 : 1,
        cursor: day.future ? 'default' : 'pointer',
      }}
    >
      {day.done && tickSvg}
    </motion.button>
  )
}

// ─── Today card ──────────────────────────────────────────────────────────────

function TodayCard({ habit, expanded, onExpand, onToggleDay, onGoal }: {
  habit: HabitView
  expanded: boolean
  onExpand: () => void
  onToggleDay: (date: string, completed: boolean) => void
  onGoal: (perWeek: number) => void
}) {
  const today = habit.week.find((d) => d.today)
  const done = !!today?.done
  const pct = Math.min(100, Math.round((habit.weeklyDone / habit.perWeek) * 100))

  return (
    <div className="overflow-hidden rounded-2xl border transition-colors" style={{
      borderColor: done ? 'rgba(74,222,128,0.28)' : 'var(--cosmic-border)',
      background: done ? 'rgba(74,222,128,0.045)' : 'var(--cosmic-surface)',
    }}>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onExpand}>
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl text-[18px]" style={{ background: 'rgba(255,255,255,0.05)' }}>{habit.emoji}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold text-white">{habit.name}</span>
              {habit.kind === 'auto' && <span className="flex-none rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-[0.1em]" style={{ color: GREEN, background: 'rgba(74,222,128,0.12)' }}>auto</span>}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[11.5px] tabular-nums" style={{ color: '#52525b' }}>{habit.weeklyDone}/{habit.perWeek} this week</span>
              <span className="h-[3px] w-14 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }}>
                <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: GREEN }} />
              </span>
            </div>
          </div>
        </button>
        {today && <BigCheck done={done} onToggle={() => onToggleDay(today.date, !done)} />}
      </div>

      <motion.div initial={false} animate={{ height: expanded ? 'auto' : 0 }} style={{ overflow: 'hidden' }} transition={{ duration: 0.25 }}>
        <div className="border-t px-3.5 pb-4 pt-3" style={{ borderColor: 'var(--cosmic-border)' }}>
          <div className="mb-3.5 grid grid-cols-7 gap-1">
            {habit.week.map((d, i) => (
              <div key={d.date} className="flex flex-col items-center gap-1.5">
                <span className="text-[8.5px] font-bold uppercase tracking-wide" style={{ color: '#52525b' }}>{WEEKDAYS[i]}</span>
                <WeekDot day={d} onToggle={() => onToggleDay(d.date, !d.done)} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium text-white/60">
              {habit.streakWeeks > 0 ? `🔥 ${habit.streakWeeks} week${habit.streakWeeks > 1 ? 's' : ''} on target` : 'No streak yet'}
            </span>
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: '#52525b' }}>Goal</span>
              <div className="flex items-center overflow-hidden rounded-lg border" style={{ borderColor: 'var(--cosmic-border)', background: 'rgba(255,255,255,0.04)' }}>
                <button className="h-[30px] w-[30px] text-[17px] font-semibold text-[#dffbe9] disabled:opacity-30" disabled={habit.perWeek <= 1} onClick={() => onGoal(habit.perWeek - 1)}>−</button>
                <span className="min-w-[48px] text-center text-[12.5px] font-bold tabular-nums">{habit.perWeek}×/wk</span>
                <button className="h-[30px] w-[30px] text-[17px] font-semibold text-[#dffbe9] disabled:opacity-30" disabled={habit.perWeek >= 7} onClick={() => onGoal(habit.perWeek + 1)}>+</button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Week grid — one selected week, from the history pager ───────────────────

function WeekGrid({ week, isLoading, todayDate, onToggleDay }: {
  week: HabitHistoryWeek | undefined
  isLoading: boolean
  todayDate: string
  onToggleDay: (id: string, date: string, completed: boolean) => void
}) {
  if (isLoading || !week) {
    return <div className="py-16 text-center text-[13px]" style={{ color: '#52525b' }}>{isLoading ? 'Loading…' : 'No data'}</div>
  }
  return (
    <>
      <div className="mb-2 grid items-center gap-1 px-1" style={{ gridTemplateColumns: '116px repeat(7, 1fr)' }}>
        <span />
        {WEEKDAYS.map((d, i) => <span key={i} className="text-center text-[8.5px] font-bold uppercase tracking-wide" style={{ color: '#52525b' }}>{d}</span>)}
      </div>
      <div className="flex flex-col gap-1.5">
        {week.habits.map((h) => (
          <div key={h.id} className="grid items-center gap-1 rounded-xl border py-2 pl-3 pr-1" style={{ gridTemplateColumns: '116px repeat(7, 1fr)', borderColor: 'var(--cosmic-border)', background: 'var(--cosmic-surface)' }}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex-none text-[15px]">{h.emoji}</span>
              <span className="truncate text-[12.5px] font-semibold">{h.name}</span>
            </div>
            {h.done.map((dn, di) => {
              const date = week.dates[di]
              return (
                <div key={date} className="flex justify-center">
                  <WeekDot day={{ done: dn, today: date === todayDate, future: date > todayDate }} onToggle={() => onToggleDay(h.id, date, !dn)} />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HabitsClient({ initial }: { initial: HabitView[] }) {
  const router = useRouter()
  const { data: habits = [] } = useHabits(initial)
  const toggle = useToggleHabit()
  const updateGoal = useUpdateGoal()
  const logAll = useLogAll()

  const [view, setView] = useState<'today' | 'week'>('today')
  const [weekIndex, setWeekIndex] = useState(0) // 0 = this week
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: weeks, isLoading: histLoading } = useHabitHistory(view === 'week')
  const week = weeks?.[weekIndex]

  const todayDate = habits[0]?.week.find((d) => d.today)?.date ?? ''
  const todayDone = habits.filter((h) => h.week.find((d) => d.today)?.done).length
  const weekPct = habits.length
    ? Math.round((habits.reduce((s, h) => s + Math.min(1, h.perWeek ? h.weeklyDone / h.perWeek : 0), 0) / habits.length) * 100)
    : 0
  const manual = habits.filter((h) => h.kind === 'manual')
  const allManualDone = manual.length > 0 && manual.every((h) => h.week.find((d) => d.today)?.done)

  return (
    <main className="min-h-screen px-5 pb-28 pt-14" style={{ background: 'radial-gradient(ellipse 55% 40% at 50% 0%, rgba(74,222,128,0.05), transparent 70%)' }}>
      <div className="mb-5">
        <motion.button onClick={() => router.push('/')} whileTap={{ scale: 0.9 }} className="mb-3 grid h-9 w-9 place-items-center rounded-full" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--cosmic-border)' }} aria-label="Back to home">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </motion.button>
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Habits</h1>
            <p className="mt-0.5 text-xs" style={{ color: '#52525b' }}>log your day</p>
          </div>
          <div className="flex gap-2">
            <div className="rounded-xl border px-3 py-1.5 text-center" style={{ borderColor: 'var(--cosmic-border)', background: 'var(--cosmic-surface)' }}>
              <div className="text-[15px] font-bold tabular-nums">{todayDone}/{habits.length}</div>
              <div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.13em]" style={{ color: '#52525b' }}>Today</div>
            </div>
            <div className="rounded-xl border px-3 py-1.5 text-center" style={{ borderColor: 'var(--cosmic-border)', background: 'var(--cosmic-surface)' }}>
              <div className="text-[15px] font-bold tabular-nums" style={{ color: GREEN }}>{weekPct}%</div>
              <div className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.13em]" style={{ color: '#52525b' }}>Week</div>
            </div>
          </div>
        </div>
      </div>

      {/* toggle row: Today | Week, with Log all (today) or inline week nav (week) */}
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex gap-0.5 rounded-xl border p-0.5" style={{ borderColor: 'var(--cosmic-border)', background: 'rgba(255,255,255,0.03)' }}>
          {(['today', 'week'] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); setWeekIndex(0) }} className="rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-semibold capitalize transition-colors"
              style={view === v ? { color: '#eafff2', background: 'rgba(74,222,128,0.13)', boxShadow: 'inset 0 0 0 1px rgba(74,222,128,0.32)' } : { color: 'rgba(255,255,255,0.5)' }}>{v}</button>
          ))}
        </div>

        {view === 'today' && (
          <button onClick={() => logAll.mutate({ date: todayDate, completed: !allManualDone })} className="ml-auto rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold"
            style={{ color: '#dffbe9', borderColor: 'rgba(74,222,128,0.4)', background: 'radial-gradient(120% 150% at 50% 0%, rgba(74,222,128,0.18), transparent)' }}>
            {allManualDone ? '↺ Reset today' : 'Log all'}
          </button>
        )}

        {view === 'week' && (
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setWeekIndex((i) => Math.min((weeks?.length ?? 1) - 1, i + 1))} disabled={!weeks || weekIndex >= weeks.length - 1}
              className="grid h-7 w-7 place-items-center rounded-full border disabled:opacity-25" style={{ borderColor: 'var(--cosmic-border)' }} aria-label="Older week">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span className="min-w-[86px] text-center text-[12px] font-bold tabular-nums">
              {week ? (weekIndex === 0 ? 'This week' : `${fmtMD(week.startDate)} – ${fmtMD(week.endDate)}`) : '…'}
            </span>
            <button onClick={() => setWeekIndex((i) => Math.max(0, i - 1))} disabled={weekIndex <= 0}
              className="grid h-7 w-7 place-items-center rounded-full border disabled:opacity-25" style={{ borderColor: 'var(--cosmic-border)' }} aria-label="Newer week">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
        )}
      </div>

      {view === 'today' && (
        <div className="flex flex-col gap-2">
          {habits.map((h) => (
            <TodayCard
              key={h.id}
              habit={h}
              expanded={expandedId === h.id}
              onExpand={() => setExpandedId((x) => (x === h.id ? null : h.id))}
              onToggleDay={(date, completed) => toggle.mutate({ id: h.id, date, completed })}
              onGoal={(perWeek) => updateGoal.mutate({ id: h.id, perWeek })}
            />
          ))}
        </div>
      )}

      {view === 'week' && (
        <WeekGrid week={week} isLoading={histLoading} todayDate={todayDate} onToggleDay={(id, date, completed) => toggle.mutate({ id, date, completed })} />
      )}
    </main>
  )
}
