import type { createServiceClient } from '@/lib/supabase/server'

// Training activity derived from gym_logs — the live set-logging system.
// The legacy `workouts` table stopped receiving writes in May 2026; anything
// that summarizes training must read gym_logs instead.

type DB = ReturnType<typeof createServiceClient>

export interface GymActivityLog {
  logged_at: string
  weight: number
  reps: number
  gym_exercises: { name: string } | null
}

export async function fetchGymLogs(db: DB, userId: string, sinceIso: string, limit = 400): Promise<GymActivityLog[]> {
  const { data, error } = await db
    .from('gym_logs')
    .select('logged_at, weight, reps, gym_exercises(name)')
    .eq('user_id', userId)
    .gte('logged_at', sinceIso)
    .order('logged_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as GymActivityLog[]
}

// Compact label for a session's logs: "Bench Press, Squat +1 more"
export function sessionLabel(logs: GymActivityLog[], max = 3): string {
  const names = [...new Set(logs.map(l => l.gym_exercises?.name ?? 'Unknown'))]
  const shown = names.slice(0, max).join(', ')
  return names.length > max ? `${shown} +${names.length - max} more` : shown
}

export function sessionVolumeLbs(logs: GymActivityLog[]): number {
  return logs.reduce((sum, l) => sum + (l.weight ?? 0) * (l.reps ?? 0), 0)
}

// Group logs into per-day sessions keyed by dayKey(logged_at). Because callers
// pass logs sorted newest-first, the map's insertion order is newest day first.
export function groupByDay(logs: GymActivityLog[], dayKey: (iso: string) => string): Map<string, GymActivityLog[]> {
  const days = new Map<string, GymActivityLog[]>()
  for (const log of logs) {
    const key = dayKey(log.logged_at)
    const existing = days.get(key)
    if (existing) existing.push(log)
    else days.set(key, [log])
  }
  return days
}
