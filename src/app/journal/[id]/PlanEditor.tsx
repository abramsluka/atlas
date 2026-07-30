'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlanItem } from '@/features/journal/types'

interface Props {
  plan: PlanItem[]
  planning: boolean
  onChange: (next: PlanItem[]) => void
}

// The plan renders as one textarea per item (needed so long tasks wrap under
// their own checkbox), but the keyboard makes them behave like lines of a single
// document: Enter splits at the caret, Backspace at position 0 merges into the
// line above, forward Delete at the end merges the line below up, and the arrow
// keys walk between lines.
export default function PlanEditor({ plan, planning, onChange }: Props) {
  const itemRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const [focusRequest, setFocusRequest] = useState<{ id: string; caret: number } | null>(null)

  useEffect(() => {
    if (!focusRequest) return
    const el = itemRefs.current.get(focusRequest.id)
    if (!el) return
    el.focus()
    const caret = Math.min(focusRequest.caret, el.value.length)
    el.setSelectionRange(caret, caret)
    setFocusRequest(null)
  }, [focusRequest, plan])

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function toggleItem(id: string) {
    onChange(plan.map(p => (p.id === id ? { ...p, done: !p.done } : p)))
  }

  function editItem(id: string, text: string) {
    onChange(plan.map(p => (p.id === id ? { ...p, text } : p)))
  }

  function deleteItem(id: string) {
    onChange(plan.filter(p => p.id !== id))
  }

  function addItem() {
    const item: PlanItem = { id: crypto.randomUUID(), text: '', done: false }
    onChange([...plan, item])
    setFocusRequest({ id: item.id, caret: 0 })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, index: number) {
    if (e.nativeEvent.isComposing) return
    const el = e.currentTarget
    const { selectionStart, selectionEnd, value } = el
    const item = plan[index]

    if (e.key === 'Enter') {
      e.preventDefault()
      const newItem: PlanItem = {
        id: crypto.randomUUID(),
        text: value.slice(selectionEnd),
        done: false,
      }
      const next = [...plan]
      next[index] = { ...item, text: value.slice(0, selectionStart) }
      next.splice(index + 1, 0, newItem)
      onChange(next)
      setFocusRequest({ id: newItem.id, caret: 0 })
      return
    }

    if (e.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0) {
      if (index === 0) return
      e.preventDefault()
      const prev = plan[index - 1]
      const next = [...plan]
      next[index - 1] = { ...prev, text: prev.text + value }
      next.splice(index, 1)
      onChange(next)
      setFocusRequest({ id: prev.id, caret: prev.text.length })
      return
    }

    if (e.key === 'Delete' && selectionStart === value.length && selectionEnd === value.length) {
      if (index === plan.length - 1) return
      e.preventDefault()
      const below = plan[index + 1]
      const next = [...plan]
      next[index] = { ...item, text: value + below.text }
      next.splice(index + 1, 1)
      onChange(next)
      setFocusRequest({ id: item.id, caret: value.length })
      return
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const up = e.key === 'ArrowUp'
      const targetIndex = up ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= plan.length) return
      // Wrapped items keep native caret movement inside the wrap; the caret
      // only jumps lists at the text boundary. Single-line items always jump.
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20
      const wrapped = el.scrollHeight > lineHeight * 1.5
      if (wrapped && (up ? selectionStart > 0 : selectionEnd < value.length)) return
      e.preventDefault()
      setFocusRequest({ id: plan[targetIndex].id, caret: selectionStart })
    }
  }

  return (
    <div>
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">
        ☀️ Today&apos;s plan
      </p>
      <div className={`space-y-1 ${planning ? 'opacity-50' : ''}`}>
        {plan.map((item, index) => (
          <div key={item.id} className="group flex items-start gap-3 rounded-xl px-1 py-1.5">
            <button
              onClick={() => toggleItem(item.id)}
              className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md transition-colors"
              style={{
                background: item.done ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)',
                border: item.done ? '1px solid rgba(251,191,36,0.4)' : '1px solid rgba(255,255,255,0.15)',
              }}
            >
              {item.done && <span className="text-[11px] leading-none text-amber-300">✓</span>}
            </button>
            <textarea
              value={item.text}
              rows={1}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(item.id, el)
                  autoGrow(el)
                } else {
                  itemRefs.current.delete(item.id)
                }
              }}
              placeholder="What's the move?"
              onChange={(e) => {
                editItem(item.id, e.target.value)
                autoGrow(e.target)
              }}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`min-w-0 flex-1 resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-zinc-700 transition-colors ${
                item.done
                  ? 'text-zinc-500 line-through decoration-zinc-600'
                  : 'text-white'
              }`}
            />
            <button
              onClick={() => deleteItem(item.id)}
              className="px-1 text-zinc-700 active:text-zinc-400"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addItem}
        className="mt-2 px-1 text-sm text-zinc-600 active:text-zinc-400"
      >
        + Add a line
      </button>
    </div>
  )
}
