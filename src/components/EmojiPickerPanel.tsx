'use client'

import { useEffect, useRef, useState } from 'react'

// Searchable in-app emoji picker (emoji-picker-element web component). Loaded
// client-only — the element touches window/customElements, so a top-level
// import would break SSR. Emoji data is self-hosted (/emoji-data.json) to avoid
// an external CDN fetch at runtime. Falls back to a text input if it can't load.
//
// Shared surface: the habits edit sheet opens it as a sub-view, the food emoji
// picker opens it as an overlay above the meal sheet. Regenerate
// public/emoji-data.json from emoji-picker-element-data if the lib is bumped.
export default function EmojiPickerPanel({
  onPick,
  height = 360,
  accent = '#ffffff',
  accentText = '#0a0a0b',
}: {
  onPick: (emoji: string) => void
  height?: number
  /** Fallback "Use" button colour, so each surface keeps its own accent. */
  accent?: string
  accentText?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const [failed, setFailed] = useState(false)
  const [manual, setManual] = useState('')

  useEffect(() => {
    let picker: HTMLElement | null = null
    let cancelled = false
    const handler = (e: Event) => {
      const unicode = (e as CustomEvent<{ unicode?: string }>).detail?.unicode
      if (unicode) onPickRef.current(unicode)
    }
    import('emoji-picker-element')
      .then(() => {
        if (cancelled || !ref.current) return
        picker = document.createElement('emoji-picker')
        ;(picker as unknown as { dataSource: string }).dataSource = '/emoji-data.json'
        picker.classList.add('dark')
        picker.style.width = '100%'
        picker.style.height = `${height}px`
        picker.style.setProperty('--background', '#111113')
        picker.style.setProperty('--border-color', 'rgba(255,255,255,0.08)')
        picker.style.setProperty('--input-border-color', 'rgba(255,255,255,0.14)')
        picker.addEventListener('emoji-click', handler)
        ref.current.appendChild(picker)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      picker?.removeEventListener('emoji-click', handler)
      picker?.remove()
    }
  }, [height])

  if (failed) {
    return (
      <div className="py-3">
        <p className="mb-2 text-[12px]" style={{ color: '#52525b' }}>Type or paste an emoji:</p>
        <div className="flex gap-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} autoFocus aria-label="Emoji"
            className="h-12 w-16 flex-none rounded-xl border text-center text-[22px] text-white"
            style={{ borderColor: 'var(--cosmic-border)', background: 'rgba(255,255,255,0.05)' }} />
          <button onClick={() => { if (manual.trim()) onPickRef.current(manual.trim()) }}
            className="rounded-xl px-4 text-[13px] font-bold" style={{ background: accent, color: accentText }}>Use</button>
        </div>
      </div>
    )
  }
  return <div ref={ref} className="overflow-hidden rounded-xl" />
}
