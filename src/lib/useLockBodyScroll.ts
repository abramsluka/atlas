import { useEffect } from 'react'

// Freezes the page behind a modal/sheet. overflow:hidden alone isn't enough on
// iOS Safari — touch scrolling still reaches the body once an inner scroller
// hits its bounds — so pin the body with position:fixed at the current scroll
// offset and restore it on unlock.
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const body = document.body
    const scrollY = window.scrollY
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.left = prev.left
      body.style.right = prev.right
      body.style.width = prev.width
      body.style.overflow = prev.overflow
      window.scrollTo(0, scrollY)
    }
  }, [locked])
}
