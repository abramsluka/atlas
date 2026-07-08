// Read-only view of the gym set-timer state. GymClient owns and persists the
// timer to localStorage; this module lets other surfaces (the Orb) know a
// workout is in progress without coupling to the gym page's component tree.

export const SET_TIMER_KEY = 'atlas.gym.timer'

export interface GymTimerState {
  phase: 'idle' | 'active' | 'rest'
  phaseStart: number | null
  sessionStart: number | null
}

// Mirrors GymClient's restore rule: a timer only counts as an active session
// when it's mid-phase and fresh (< 6h) — a stale next-day timer reads as idle.
export function readGymSession(): { active: boolean; minutes: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SET_TIMER_KEY) || 'null') as GymTimerState | null
    if (saved?.phase && saved.phase !== 'idle' && saved.phaseStart && Date.now() - saved.phaseStart < 6 * 3600_000) {
      const minutes = saved.sessionStart ? Math.max(0, Math.round((Date.now() - saved.sessionStart) / 60_000)) : 0
      return { active: true, minutes }
    }
  } catch {}
  return { active: false, minutes: 0 }
}
