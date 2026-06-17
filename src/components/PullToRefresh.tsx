'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

const THRESHOLD = 70   // damped px needed to trigger a refresh
const MAX_PULL = 120   // clamp the rubber-band
const HOLD = 56        // px the content holds open while refreshing
const SNAP = 'transform 0.3s cubic-bezier(0.16,1,0.3,1)'

// App-wide pull-to-refresh: when the page is scrolled to the very top and you
// drag down, this rubber-bands the content, shows a spinner, and on release past
// the threshold re-fetches everything (router.refresh() for server data +
// invalidateQueries() for all TanStack queries). Mirrors the native Oura/Whoop
// gesture, which iOS hides in standalone PWA mode.
export default function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const contentRef = useRef<HTMLDivElement>(null)
  const spinnerRef = useRef<HTMLDivElement>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const drag = useRef({ startY: 0, pulling: false, pull: 0, settleTimer: 0 })

  useEffect(() => {
    const content = contentRef.current
    const spinner = spinnerRef.current
    if (!content || !spinner) return

    const draw = (pull: number) => {
      content.style.transition = 'none'
      content.style.transform = `translateY(${pull}px)`
      const p = Math.min(pull / THRESHOLD, 1)
      spinner.style.transition = 'none'
      spinner.style.opacity = String(Math.min(pull / 40, 1))
      spinner.style.transform = `translateX(-50%) translateY(${Math.min(pull, HOLD)}px) rotate(${pull * 3}deg) scale(${0.5 + p * 0.5})`
    }

    const settle = () => {
      content.style.transition = SNAP
      content.style.transform = 'translateY(0px)'
      spinner.style.transition = 'opacity 0.25s ease, transform 0.3s ease'
      spinner.style.opacity = '0'
      spinner.classList.remove('ptr-spin')
      // clear the transform once settled so it never creates a containing block
      // for position:fixed descendants (modals, sheets) at rest
      drag.current.settleTimer = window.setTimeout(() => {
        content.style.transition = 'none'
        content.style.transform = 'none'
      }, 320)
    }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || window.scrollY > 0 || e.touches.length !== 1) return
      const target = e.target as HTMLElement
      if (target.closest?.('.overflow-y-auto, input, textarea, [contenteditable="true"]')) return
      if (drag.current.settleTimer) { clearTimeout(drag.current.settleTimer); drag.current.settleTimer = 0 }
      drag.current.startY = e.touches[0].clientY
      drag.current.pulling = true
      drag.current.pull = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!drag.current.pulling || refreshingRef.current) return
      const dy = e.touches[0].clientY - drag.current.startY
      if (dy <= 0 || window.scrollY > 0) {
        drag.current.pulling = false
        if (drag.current.pull > 0) settle()
        return
      }
      e.preventDefault() // stop native scroll/bounce while pulling
      const pull = Math.min(dy * 0.5, MAX_PULL)
      drag.current.pull = pull
      draw(pull)
    }

    const onEnd = () => {
      if (!drag.current.pulling || refreshingRef.current) return
      drag.current.pulling = false
      if (drag.current.pull >= THRESHOLD) void triggerRefresh()
      else if (drag.current.pull > 0) settle()
    }

    const triggerRefresh = async () => {
      refreshingRef.current = true
      setRefreshing(true)
      content.style.transition = SNAP
      content.style.transform = `translateY(${HOLD}px)`
      spinner.style.transition = SNAP
      spinner.style.opacity = '1'
      spinner.style.transform = `translateX(-50%) translateY(${HOLD}px) scale(1)`
      spinner.classList.add('ptr-spin')
      try {
        router.refresh()
        await Promise.all([
          queryClient.invalidateQueries(),
          new Promise(r => setTimeout(r, 650)), // keep the spinner visible a beat
        ])
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        settle()
      }
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [router, queryClient])

  return (
    <>
      <div
        ref={spinnerRef}
        aria-hidden={!refreshing}
        style={{ position: 'fixed', top: 6, left: '50%', zIndex: 45, opacity: 0, pointerEvents: 'none', transform: 'translateX(-50%)' }}
      >
        <div className="ptr-ring" />
      </div>
      <div ref={contentRef} style={{ willChange: 'transform' }}>
        {children}
      </div>
    </>
  )
}
