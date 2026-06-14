import { useCallback, useEffect, useRef } from 'react'

// Streaming coach responses append a token at a time, and naively calling
// scrollIntoView on every token drags the whole window to the bottom — on
// mobile this yanks the viewport down constantly and you can't read.
//
// This keeps the view pinned to the bottom only while the user is already
// there. The moment they scroll up past the threshold, following stops; scroll
// back down and it resumes. `stuck` is exposed so callers can force-resume when
// the user initiates a new message.
export function useStickToBottom(threshold = 120) {
  const stuck = useRef(true)

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement
      stuck.current = window.innerHeight + window.scrollY >= doc.scrollHeight - threshold
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])

  const scrollToBottom = useCallback((el: HTMLElement | null, smooth = false) => {
    if (stuck.current) el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  return { scrollToBottom, stuck }
}
