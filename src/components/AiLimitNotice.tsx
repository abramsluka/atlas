import { AI_LIMIT_MESSAGE } from '@/lib/apiKeyError'

// Inline "usage limit reached" notice for non-chat error surfaces (forms, cards,
// generation buttons). Chat/coach transcripts show AI_LIMIT_MESSAGE as plain
// text instead. No Settings link — there's nothing the user can change; it's a
// wait-and-retry state.
export default function AiLimitNotice({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 ${className}`}>
      <p className="text-[12px] text-amber-200/90">{AI_LIMIT_MESSAGE}</p>
    </div>
  )
}
