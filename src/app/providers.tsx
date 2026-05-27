'use client'

import { QueryClientProvider } from '@tanstack/react-query'
import { useRef } from 'react'
import { makeQueryClient } from '@/lib/query-client'

export default function Providers({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<ReturnType<typeof makeQueryClient> | null>(null)
  if (!clientRef.current) {
    clientRef.current = makeQueryClient()
  }

  return (
    <QueryClientProvider client={clientRef.current}>
      {children}
    </QueryClientProvider>
  )
}
