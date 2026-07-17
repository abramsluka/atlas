// Read-only view of the gym set-timer state. GymClient owns and persists the
// timer to localStorage; this module lets other surfaces (the Orb) know a
// workout is in progress without coupling to the gym page's component tree.

export const SET_TIMER_KEY = 'atlas.gym.timer'

// A session auto-finishes after this long with no set logged. Sets hit gym_logs
// on the spot and gym_sessions.ended_at is derived from the last one, so
// expiring the timer only retires a stale clock — it never drops data.
export const SESSION_IDLE_MS = 60 * 60_000

export interface GymTimerState {
  phase: 'idle' | 'active' | 'rest'
  phaseStart: number | null
  sessionStart: number | null
}

// phaseStart is re-stamped on every Start/End Set press, so it doubles as the
// last-activity mark. Shared with GymClient's restore + live tick so the page
// and the Orb can't disagree about whether a session is still running.
export function isTimerLive(t: GymTimerState | null, now = Date.now()): t is GymTimerState {
  return !!(t?.phase && t.phase !== 'idle' && t.phaseStart && now - t.phaseStart < SESSION_IDLE_MS)
}

export function readGymSession(): { active: boolean; minutes: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(SET_TIMER_KEY) || 'null') as GymTimerState | null
    if (isTimerLive(saved)) {
      const minutes = saved.sessionStart ? Math.max(0, Math.round((Date.now() - saved.sessionStart) / 60_000)) : 0
      return { active: true, minutes }
    }
  } catch {}
  return { active: false, minutes: 0 }
}
