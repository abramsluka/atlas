'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

type KeysResponse = { anthropic: { set: boolean }; openai: { set: boolean } }

const DISMISS_KEY = 'atlas_api_key_banner_dismissed'

// Shown on Home until the user adds their Anthropic key — every AI feature
// needs it. Dismiss hides it for the browser session; it reappears next
// session if the key is still unset. Same ['user-keys'] query as Settings,
// so saving a key there clears this immediately via cache invalidation.
export default function ApiKeyBanner() {
  const [dismissed, setDismissed] = useState(true) // default hidden until we check sessionStorage (avoid flash)

  useEffect(() => {
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1')
  }, [])

  const { data: keys } = useQuery<KeysResponse>({
    queryKey: ['user-keys'],
    queryFn: async () => (await fetch('/api/user/keys')).json(),
    staleTime: 30_000,
  })

  if (dismissed || !keys || keys.anthropic.set) return null

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3.5 py-3">
      <span className="text-lg leading-none">⚡</span>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-amber-100">Add your API keys to unlock AI features</p>
        <a href="/settings" className="text-[11.5px] text-amber-300/90 underline">
          Go to Settings →
        </a>
      </div>
      <button
        onClick={() => { sessionStorage.setItem(DISMISS_KEY, '1'); setDismissed(true) }}
        className="shrink-0 text-amber-300/50 hover:text-amber-300/90 text-lg leading-none px-1"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
