import type { KeyProvider } from '@/lib/apiKeyError'

// Inline "add your key" notice for non-chat error surfaces (forms, cards,
// generation buttons). Chat/coach transcripts use the plain-text message
// from noApiKeyMessage() instead, since those bubbles are plain strings.
export default function NoApiKeyNotice({ provider, className = '' }: { provider: KeyProvider; className?: string }) {
  const name = provider === 'anthropic' ? 'Anthropic' : 'OpenAI'
  return (
    <div className={`rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2.5 ${className}`}>
      <p className="text-[12px] text-amber-200/90">Add your {name} key in Settings to use this feature.</p>
      <a href="/settings" className="mt-1 inline-block text-[11px] font-semibold text-amber-300 underline">
        Go to Settings →
      </a>
    </div>
  )
}
