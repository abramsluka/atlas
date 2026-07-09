import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Device-local chat persistence. Drop-in replacement for `useState<T[]>([])` that
 * mirrors the thread to localStorage so it survives a page refresh — without ever
 * touching the database. Hydrates on mount and keeps only the last `max` messages.
 *
 * Pass `getDay` to scope the thread to a day key (e.g. rolledDate): storage
 * becomes `{ day, messages }`, a saved thread from a previous day is dropped on
 * hydrate, and `clearIfStale` wipes the thread when the day flips while the app
 * stays open. The day check also runs on window focus / visibility restore.
 */
export function usePersistentChat<T>(
  key: string,
  max = 50,
  getDay?: () => string,
): [T[], Dispatch<SetStateAction<T[]>>, () => void] {
  const [messages, setMessages] = useState<T[]>([])
  // Skip the very first persist (the empty mount value) so hydration can't clobber storage.
  const skipPersist = useRef(true)
  const getDayRef = useRef(getDay)
  getDayRef.current = getDay

  // Hydrate once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const day = getDayRef.current
      if (day) {
        // Day-scoped: only a same-day { day, messages } payload survives. An
        // old-format bare array or a stale day both mean "yesterday's chat".
        if (parsed?.day === day() && Array.isArray(parsed.messages)) setMessages(parsed.messages)
        else localStorage.removeItem(key)
      } else if (Array.isArray(parsed)) {
        setMessages(parsed)
      }
    } catch {}
  }, [key])

  // Persist on change.
  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false
      return
    }
    try {
      const day = getDayRef.current
      const trimmed = messages.slice(-max)
      localStorage.setItem(key, JSON.stringify(day ? { day: day(), messages: trimmed } : trimmed))
    } catch {}
  }, [key, max, messages])

  // Drop the thread if its saved day is no longer today (app left open past
  // the rollover). Runs on demand via clearIfStale and on focus/visibility.
  const clearIfStale = useRef(() => {
    const day = getDayRef.current
    if (!day) return
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (parsed?.day !== day()) {
        localStorage.removeItem(key)
        setMessages([])
      }
    } catch {}
  }).current

  useEffect(() => {
    if (!getDayRef.current) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') clearIfStale()
    }
    window.addEventListener('focus', clearIfStale)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', clearIfStale)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key, clearIfStale])

  return [messages, setMessages, clearIfStale]
}
