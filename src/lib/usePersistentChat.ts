import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * Device-local chat persistence. Drop-in replacement for `useState<T[]>([])` that
 * mirrors the thread to localStorage so it survives a page refresh — without ever
 * touching the database. Hydrates on mount and keeps only the last `max` messages.
 */
export function usePersistentChat<T>(
  key: string,
  max = 50,
): [T[], Dispatch<SetStateAction<T[]>>] {
  const [messages, setMessages] = useState<T[]>([])
  // Skip the very first persist (the empty mount value) so hydration can't clobber storage.
  const skipPersist = useRef(true)

  // Hydrate once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) setMessages(JSON.parse(raw))
    } catch {}
  }, [key])

  // Persist on change.
  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false
      return
    }
    try {
      localStorage.setItem(key, JSON.stringify(messages.slice(-max)))
    } catch {}
  }, [key, max, messages])

  return [messages, setMessages]
}
