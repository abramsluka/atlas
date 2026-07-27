'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMOJI_CHOICES, foodEmoji } from '@/features/food/foodEmoji'
import EmojiPickerPanel from '@/components/EmojiPickerPanel'

// Emoji override control for a food entry, in three tiers:
//   1. Auto — resolved from the item name, no interaction (the usual case).
//   2. Grid — one tap over the common food emoji, which covers nearly every fix.
//   3. Search — the shared EmojiPickerPanel for anything else. Deliberately the
//      last tier: it lazy-loads ~440KB of emoji data, so it only pays off when
//      the user actually wants something outside the food set.
export default function FoodEmojiPicker({
  name,
  source,
  value,
  onChange,
}: {
  name: string
  source?: string | null
  value: string | null
  onChange: (emoji: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const shown = foodEmoji(name, { source, override: value })

  function pick(emoji: string | null) {
    onChange(emoji)
    setSearching(false)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Change emoji"
        className={`h-[42px] w-[42px] shrink-0 rounded-[10px] border text-xl leading-none transition-colors ${
          open ? 'border-white/40 bg-white/[0.08]' : 'border-white/[0.12] bg-black/25'
        }`}
      >
        {shown}
      </button>

      {open && (
        <div className="absolute left-0 top-[46px] z-10 w-[min(19rem,78vw)] rounded-xl border border-white/[0.14] bg-[#17171a] p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Emoji</span>
            <button
              type="button"
              onClick={() => pick(null)}
              className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${
                value ? 'bg-white/[0.07] text-zinc-300' : 'bg-white/[0.03] text-zinc-600'
              }`}
            >
              Auto {foodEmoji(name, { source })}
            </button>
          </div>

          <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto">
            {EMOJI_CHOICES.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => pick(emoji)}
                className={`aspect-square rounded-lg text-lg leading-none transition-colors ${
                  value === emoji ? 'bg-white/[0.16]' : 'hover:bg-white/[0.07]'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSearching(true)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/[0.12] bg-black/25 py-2 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/[0.06]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" />
            </svg>
            Search all emoji
          </button>
        </div>
      )}

      {/* Portaled above the meal sheet: the sheet scrolls and clips, and the
          element brings its own scrolling, so nesting it inside would fight. */}
      {searching && mounted && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-4"
          style={{ backdropFilter: 'blur(6px)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
          onClick={() => setSearching(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/[0.14] bg-[#111113] p-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSearching(false)}
                className="flex items-center gap-1 px-1 py-1 text-[13px] font-semibold text-white/60 active:opacity-60"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                Back
              </button>
              <span className="text-base font-bold text-white">Pick an emoji</span>
              <span className="w-12" />
            </div>
            <EmojiPickerPanel onPick={pick} height={340} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
