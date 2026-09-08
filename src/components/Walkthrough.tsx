'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

// Interactive walkthrough (ONBOARDING_SPEC Part 2, step 8).
//
// Coach marks over the REAL app, not a slideshow: a dimmed overlay with one live
// UI element spotlit and a popover explaining it. Anchored to the TabBar, which
// is fixed and present on every screen — page content reorders constantly, so a
// tour pinned to cards points at the wrong thing the first time anything moves.
//
// It never navigates on the user's behalf. Auto-advancing through tabs fights
// the router, breaks the back button, and strands people mid-tour on a page they
// did not choose.

const FLAG = 'atlas-walkthrough'

/**
 * Queue the walkthrough to run on the next page the user lands on. It starts on
 * arrival rather than immediately, because every caller navigates out of a
 * surface where the TabBar is hidden (onboarding) or where the tour's last stop
 * does not exist (settings).
 */
export function startWalkthrough(includeSettings: boolean) {
  try {
    localStorage.setItem(FLAG, includeSettings ? 'nokey' : '1')
  } catch {}
}

type Stop = {
  /** data-tour attribute of the element to spotlight. Missing element → centered card. */
  target: string
  title: string
  body: string
}

const STOPS: Stop[] = [
  {
    target: 'tab-home',
    title: 'Home',
    body: 'Your day at a glance. Check in each morning and evening, read the briefing your coach wrote from yesterday, and keep your habit streaks alive.',
  },
  {
    target: 'tab-gym',
    title: 'Gym',
    body: 'Log your sets as you lift. The coach reads your whole history and tells you what weight to put on the bar next — no spreadsheet needed.',
  },
  {
    target: 'tab-health',
    title: 'Health',
    body: 'Food, water, body weight, supplements and caffeine. If you connect a ring or a watch, your sleep and recovery land here too.',
  },
  {
    target: 'tab-journal',
    title: 'Journal',
    body: 'Write it or say it out loud. The AI reflects back on what you wrote, and you can keep the conversation going from there.',
  },
  {
    target: 'tab-mentor',
    title: 'Mentor',
    body: 'The payoff. Mentor reads every one of the tabs above at once, so you can ask why your sleep tanked the week you PR’d and get a real answer.',
  },
]

const SETTINGS_STOP: Stop = {
  target: 'settings-link',
  title: 'Settings',
  body: 'Your API key lives here, along with which AI runs Atlas for you. Nothing that talks to the AI will work until a key is saved, so this is the first stop when something says it needs one.',
}

type Rect = { top: number; left: number; width: number; height: number }

export default function Walkthrough() {
  const pathname = usePathname()
  const [stops, setStops] = useState<Stop[] | null>(null)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  // Re-check on every navigation, not just on mount: this component lives in the
  // root layout and never unmounts, so the push out of /onboarding (and the full
  // reload back from a wearable OAuth redirect) both have to be able to start it.
  useEffect(() => {
    const check = () => {
      let flag: string | null = null
      try {
        flag = localStorage.getItem(FLAG)
      } catch {}
      if (!flag) return
      // Never run on top of the wizard itself or the signed-out surfaces.
      if (pathname.startsWith('/onboarding') || pathname.startsWith('/join') || pathname === '/login') return
      setStops(flag === 'nokey' ? [...STOPS, SETTINGS_STOP] : STOPS)
      setIndex(0)
    }
    check()
  }, [pathname])

  const stop = stops?.[index] ?? null

  // Measure the anchor on every step change, plus on resize and scroll so the
  // spotlight tracks the element instead of drifting off it.
  useEffect(() => {
    if (!stop) {
      setRect(null)
      return
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${stop.target}"]`)
      if (!el) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [stop])

  const finish = useCallback(() => {
    try {
      localStorage.removeItem(FLAG)
    } catch {}
    setStops(null)
    setIndex(0)
  }, [])

  const next = useCallback(() => {
    if (!stops) return
    if (index >= stops.length - 1) finish()
    else setIndex(index + 1)
  }, [stops, index, finish])

  // Escape always gets you out. A tour you cannot dismiss is a hostage situation.
  useEffect(() => {
    if (!stop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop, next, finish])

  if (!stop || !stops || typeof document === 'undefined') return null

  const isLast = index === stops.length - 1
  const pad = 6

  // The popover sits above the anchor (every anchor is in the bottom TabBar) and
  // is clamped so it can never overflow a 375px viewport.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const width = Math.min(300, vw - 24)
  const anchorCenter = rect ? rect.left + rect.width / 2 : vw / 2
  const left = Math.min(Math.max(anchorCenter - width / 2, 12), Math.max(12, vw - width - 12))
  const bottom = rect ? Math.max(12, vh - rect.top + 14) : Math.round(vh / 2 - 90)

  return createPortal(
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Atlas walkthrough">
      {/* Backdrop. Tapping it advances, which is the gesture people try first. */}
      <div className="absolute inset-0" onClick={next} />

      {/* Spotlight: a transparent hole punched out of the dim by an enormous
          spread shadow. pointer-events:none so the dim behind it still takes
          the tap and the real tab underneath is never accidentally triggered. */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-xl"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.74)',
            border: '1px solid rgba(74,222,128,0.55)',
          }}
        />
      )}
      {!rect && <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(0,0,0,0.74)' }} />}

      <div
        className="absolute rounded-2xl border border-white/12 p-4"
        style={{
          left,
          bottom,
          width,
          background: 'rgba(10,10,14,0.97)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-green-400/80">
            {index + 1} / {stops.length}
          </span>
          <button
            onClick={finish}
            className="ml-auto text-[11px] font-semibold text-white/35 underline active:text-white/60"
          >
            Skip tour
          </button>
        </div>

        <p className="mt-1.5 text-[14px] font-bold text-white">{stop.title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">{stop.body}</p>

        <div className="mt-3 flex items-center gap-2">
          {index > 0 && (
            <button
              onClick={() => setIndex((i) => i - 1)}
              className="rounded-lg border border-white/12 px-3 py-2 text-[12.5px] font-semibold text-white/70 active:opacity-70"
            >
              Back
            </button>
          )}
          <button
            onClick={next}
            className="ml-auto rounded-lg px-4 py-2 text-[12.5px] font-bold text-[#05130a] active:opacity-80"
            style={{ background: 'radial-gradient(circle at 50% 0%, #5df08e, #3ecb74)' }}
          >
            {isLast ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
