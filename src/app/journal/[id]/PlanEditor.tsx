'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlanItem } from '@/features/journal/types'

interface Props {
  plan: PlanItem[]
  planning: boolean
  onChange: (next: PlanItem[]) => void
}

interface FocusPoint { id: string; caret: number }
interface Snapshot { plan: PlanItem[]; focus: FocusPoint | null }

// A run of typing folds into one undo step until this much idle time passes,
// so Cmd+Z clears a burst of typing instead of a single character.
const COALESCE_MS = 600
const HISTORY_LIMIT = 100

// The plan renders as one textarea per item (needed so long tasks wrap under
// their own checkbox), but the keyboard makes them behave like lines of a single
// document: Enter splits at the caret, Backspace at position 0 merges into the
// line above, forward Delete at the end merges the line below up, and the arrow
// keys walk between lines.
//
// Undo/redo runs on whole-plan snapshots rather than the browser's native
// textarea history, which can only see text inside one box — it has no idea a
// row was added or merged away, so structural edits used to be unundoable.
export default function PlanEditor({ plan, planning, onChange }: Props) {
  const itemRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const containerRef = useRef<HTMLDivElement>(null)
  const [focusRequest, setFocusRequest] = useState<FocusPoint | null>(null)

  const past = useRef<Snapshot[]>([])
  const future = useRef<Snapshot[]>([])
  const coalesce = useRef<{ key: string | null; at: number }>({ key: null, at: 0 })
  const lastEmitted = useRef<PlanItem[] | null>(null)

  // A plan that didn't come from this editor (first load, AI generation, a voice
  // refine) starts a fresh history — undo should never rewind across a plan the
  // model just rebuilt.
  useEffect(() => {
    if (plan === lastEmitted.current) return
    past.current = []
    future.current = []
    coalesce.current = { key: null, at: 0 }
  }, [plan])

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

  function currentFocus(): FocusPoint | null {
    const active = document.activeElement
    for (const [id, node] of itemRefs.current) {
      if (node === active) return { id, caret: node.selectionStart ?? 0 }
    }
    return null
  }

  // Every edit goes through here so it lands in the undo stack. `coalesceKey`
  // groups consecutive edits of the same kind (typing in one line); structural
  // edits pass null and always get their own step.
  function commit(next: PlanItem[], focusAfter: FocusPoint | null, coalesceKey: string | null) {
    const now = Date.now()
    const groupWithPrevious =
      coalesceKey !== null &&
      coalesceKey === coalesce.current.key &&
      now - coalesce.current.at < COALESCE_MS

    if (!groupWithPrevious) {
      past.current.push({ plan, focus: currentFocus() })
      if (past.current.length > HISTORY_LIMIT) past.current.shift()
    }
    coalesce.current = { key: coalesceKey, at: now }
    future.current = []

    lastEmitted.current = next
    onChange(next)
    if (focusAfter) setFocusRequest(focusAfter)
  }

  function undo() {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ plan, focus: currentFocus() })
    coalesce.current = { key: null, at: 0 }
    lastEmitted.current = prev.plan
    onChange(prev.plan)
    if (prev.focus) setFocusRequest(prev.focus)
  }

  function redo() {
    const restored = future.current.pop()
    if (!restored) return
    past.current.push({ plan, focus: currentFocus() })
    coalesce.current = { key: null, at: 0 }
    lastEmitted.current = restored.plan
    onChange(restored.plan)
    if (restored.focus) setFocusRequest(restored.focus)
  }

  function toggleItem(id: string) {
    commit(plan.map(p => (p.id === id ? { ...p, done: !p.done } : p)), null, null)
  }

  function editItem(id: string, text: string) {
    commit(plan.map(p => (p.id === id ? { ...p, text } : p)), null, `type:${id}`)
  }

  function deleteItem(id: string) {
    commit(plan.filter(p => p.id !== id), null, null)
    // Tapping × blurs the line, which would put Cmd+Z out of this editor's
    // reach. Park focus on the container (a div, so no mobile keyboard) so the
    // delete stays undoable.
    containerRef.current?.focus({ preventScroll: true })
  }

  function addItem() {
    const item: PlanItem = { id: crypto.randomUUID(), text: '', done: false }
    commit([...plan, item], { id: item.id, caret: 0 }, null)
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
      commit(next, { id: newItem.id, caret: 0 }, null)
      return
    }

    if (e.key === 'Backspace' && selectionStart === 0 && selectionEnd === 0) {
      if (index === 0) return
      e.preventDefault()
      const prev = plan[index - 1]
      const next = [...plan]
      next[index - 1] = { ...prev, text: prev.text + value }
      next.splice(index, 1)
      commit(next, { id: prev.id, caret: prev.text.length }, null)
      return
    }

    if (e.key === 'Delete' && selectionStart === value.length && selectionEnd === value.length) {
      if (index === plan.length - 1) return
      e.preventDefault()
      const below = plan[index + 1]
      const next = [...plan]
      next[index] = { ...item, text: value + below.text }
      next.splice(index + 1, 1)
      commit(next, { id: item.id, caret: value.length }, null)
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

  // Undo/redo lives on the container so it works from any line and from the
  // container itself after an × delete. Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z redo
  // (Ctrl+Y too, for Windows habits).
  function handleHistoryKeys(e: React.KeyboardEvent) {
    if (!e.metaKey && !e.ctrlKey) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault()
      redo()
    }
  }

  return (
    <div ref={containerRef} tabIndex={-1} onKeyDown={handleHistoryKeys} className="outline-none">
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
        + Add a task
      </button>
    </div>
  )
}
