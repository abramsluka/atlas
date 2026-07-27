'use client'

import { useEffect, useLayoutEffect } from 'react'

// Deep-linking to a section (e.g. /health#water) can't rely on the browser's
// native hash jump: App Router pages render their sections after the TanStack
// queries settle, so the target element usually doesn't exist yet on mount —
// and the sections above it keep growing as they load, pushing the target down
// after we've already scrolled.
//
// So: align in a LAYOUT effect (before the first paint, so the page appears
// already at the section rather than scrolling into it), then re-align every
// frame while content above keeps loading. Each correction also lands before
// its frame paints, so the section stays visually pinned instead of sliding —
// no jitter. Any manual scroll input cancels immediately: never fight the user.

const SETTLE_MS = 2500

// Client components are still SSR'd, and useLayoutEffect warns there.
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function useHashScroll() {
  useIsoLayoutEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (!id) return

    let cancelled = false
    let frame = 0
    let lastTop = Number.NaN
    let expectedY = Number.NaN

    const cancel = () => { cancelled = true }
    window.addEventListener('wheel', cancel, { passive: true })
    window.addEventListener('touchmove', cancel, { passive: true })  // touchmove, not touchstart: a tap isn't a scroll
    window.addEventListener('keydown', cancel)

    const started = performance.now()

    const align = () => {
      const el = document.getElementById(id)
      if (!el) return
      // Document-space offset — stable under our own scrolling, so it only
      // moves when content above the target grows or shrinks.
      const top = el.getBoundingClientRect().top + window.scrollY
      const moved = Math.abs(top - lastTop) >= 1
      // The router's own scroll restoration can yank us back to the top after
      // we've already aligned. Manual scrolling has cancelled us by now, so any
      // drift left here is somebody else's scroll — take it back.
      const drifted = Number.isFinite(expectedY) && Math.abs(window.scrollY - expectedY) >= 1
      if (!moved && !drifted) return
      lastTop = top
      el.scrollIntoView({ behavior: 'auto', block: 'start' })  // scroll-mt-* sets the gap
      expectedY = window.scrollY
    }

    const tick = () => {
      if (cancelled) return
      align()
      if (performance.now() - started < SETTLE_MS) frame = requestAnimationFrame(tick)
    }

    align()  // before first paint
    frame = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      window.removeEventListener('wheel', cancel)
      window.removeEventListener('touchmove', cancel)
      window.removeEventListener('keydown', cancel)
    }
  }, [])
}
