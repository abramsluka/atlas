// Per-exercise progression briefing for the AI coaches.
//
// The mentor used to receive raw sets and eyeball them, which meant it could
// contradict the Gym tab's own prescription — the tab saying "hold 135" while
// the chat said "you're stalling, drop it". Both now read the same engine.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GymExercise, GymLog } from '@/features/gym/types'
import { buildSessionHistory, decideProgression, specFromExercise } from '@/features/gym/progression'

const HISTORY_DAYS = 180
const MAX_EXERCISES = 10

function fmt(n: number): string {
  return Number(n.toFixed(2)).toString()
}

/**
 * A compact line per recently-trained lift: the call, the numbers behind it,
 * and the concrete target. Empty string when there is nothing to say.
 */
export async function buildProgressionBriefing(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  userId: string,
  units = 'lbs',
): Promise<string> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString()

  const [exRes, logRes] = await Promise.all([
    db.from('gym_exercises').select('*').eq('user_id', userId),
    db.from('gym_logs').select('*').eq('user_id', userId).gte('logged_at', since).order('logged_at'),
  ])

  const exercises = (exRes.data ?? []) as GymExercise[]
  const logs = (logRes.data ?? []) as GymLog[]
  if (!exercises.length || !logs.length) return ''

  const byExercise = new Map<string, GymLog[]>()
  for (const l of logs) {
    const arr = byExercise.get(l.exercise_id)
    if (arr) arr.push(l)
    else byExercise.set(l.exercise_id, [l])
  }

  const rows: { lastTrained: string; line: string }[] = []

  for (const ex of exercises) {
    const exLogs = byExercise.get(ex.id)
    if (!exLogs?.length) continue

    const spec = specFromExercise(ex, units)
    const history = buildSessionHistory(exLogs, spec)
    if (history.length < 2) continue

    const rx = decideProgression(history, spec)
    if (!rx) continue

    const latest = history[history.length - 1]
    const s = rx.signals
    const t = rx.trend

    const facts = [
      `last ${latest.daysAgo === 0 ? 'today' : `${latest.daysAgo}d ago`}: ${
        spec.bodyweight ? `${latest.workReps.join('/')} reps` : `${fmt(latest.workWeight)}${units} × ${latest.workReps.join('/')}`
      }`,
      `top set ${s.topSetReps} vs ${spec.repMin}-${spec.repMax} target`,
      t ? `e1RM ${t.pctPerSession >= 0 ? '+' : ''}${t.pctPerSession.toFixed(1)}%/session over ${t.window}` : null,
      s.sessionsAtWeight > 1 ? `${s.sessionsAtWeight} sessions at this load` : null,
      rx.flags.length ? rx.flags.join(', ') : null,
    ].filter(Boolean)

    const target = rx.target
      ? spec.bodyweight
        ? `${rx.target.reps} reps`
        : `${fmt(rx.target.weight)}${units} × ${rx.target.reps}`
      : 'n/a'

    rows.push({
      lastTrained: latest.dateKey,
      line: `${ex.name} — ${rx.action} (${rx.confidence} confidence). ${rx.headline}.\n    ${facts.join(' · ')}\n    next session: ${target}`,
    })
  }

  if (!rows.length) return ''

  rows.sort((a, b) => b.lastTrained.localeCompare(a.lastTrained))
  return rows.slice(0, MAX_EXERCISES).map(r => `  ${r.line}`).join('\n')
}
