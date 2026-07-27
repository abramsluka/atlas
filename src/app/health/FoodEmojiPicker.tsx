'use client'

import { useState } from 'react'
import { EMOJI_CHOICES, foodEmoji } from '@/features/food/foodEmoji'

// Emoji override control for a food entry. Shows the currently resolved emoji
// (auto-assigned from the name unless the user picked one); tapping opens a
// grid plus a free-text field for any emoji the keyboard can produce.
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
  const shown = foodEmoji(name, { source, override: value })

  function pick(emoji: string | null) {
    onChange(emoji)
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

          <input
            value={value ?? ''}
            onChange={e => onChange(e.target.value.trim().slice(0, 8) || null)}
            placeholder="or type any emoji"
            maxLength={8}
            className="mt-2 w-full rounded-lg border border-white/[0.12] bg-black/25 px-2.5 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-white/40"
          />
        </div>
      )}
    </div>
  )
}
