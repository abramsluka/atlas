'use client'

// Confirm card for a proposed assistant action — adapted from GymChatbot's
// inline cards. Pending → tap Confirm to execute (or Dismiss); the parent owns
// status transitions.

import { describeAction, type ProposedAction } from './actions'

export default function ActionCard({
  pa,
  units,
  busy,
  onConfirm,
  onDismiss,
}: {
  pa: ProposedAction
  units: string
  busy: boolean
  onConfirm: () => void
  onDismiss: () => void
}) {
  const d = describeAction(pa.action, units)

  return (
    <div
      className="mt-2 rounded-2xl px-3.5 py-3"
      style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.18)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] font-bold text-zinc-100">{d.title}</span>
      </div>
      {d.detail && <p className="text-[11.5px] text-zinc-400 mt-0.5">{d.detail}</p>}
      {pa.action.kind === 'propose_workout' && (
        <ul className="mt-1.5 space-y-0.5">
          {pa.action.exercises.map((ex, i) => (
            <li key={i} className="text-[11.5px] text-zinc-300">
              · {ex.name} <span className="text-zinc-500">{ex.rep_min}–{ex.rep_max}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2.5">
        {pa.status === 'pending' && (
          <div className="flex items-center gap-2">
            <button
              onClick={onConfirm}
              disabled={busy}
              className="text-[12px] font-bold px-3.5 py-1.5 rounded-full disabled:opacity-50"
              style={{ background: 'rgba(74,222,128,0.18)', border: '1px solid rgba(74,222,128,0.4)', color: '#bbf7d0' }}
            >
              {busy ? '…' : d.confirmLabel}
            </button>
            <button
              onClick={onDismiss}
              disabled={busy}
              className="text-[12px] px-3 py-1.5 rounded-full text-zinc-500 disabled:opacity-50"
              style={{ border: '1px solid rgba(255,255,255,0.1)' }}
            >
              Dismiss
            </button>
          </div>
        )}
        {pa.status === 'done' && (
          <span className="text-[12px] font-bold" style={{ color: '#4ade80' }}>✓ {d.doneLabel}</span>
        )}
        {pa.status === 'dismissed' && <span className="text-[12px] text-zinc-600">Dismissed</span>}
        {pa.status === 'error' && (
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: '#f87171' }}>Failed</span>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="text-[12px] px-3 py-1 rounded-full text-zinc-300 disabled:opacity-50"
              style={{ border: '1px solid rgba(255,255,255,0.14)' }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
