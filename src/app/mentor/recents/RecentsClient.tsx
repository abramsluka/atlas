'use client'

// Mentor chat history — a dedicated page (claude.ai/recents style). Lists past
// conversations newest-first with auto-titles + relative time. Tap to open in
// /mentor?c=<id>; swipe-free delete via the trash button.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'

interface Conversation { id: string; title: string | null; created_at: string; updated_at: string }

function relTime(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function RecentsClient() {
  const router = useRouter()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['mentor-conversations'],
    queryFn: async (): Promise<Conversation[]> => {
      const res = await fetch('/api/mentor/conversations')
      if (!res.ok) throw new Error('failed')
      return (await res.json()).conversations ?? []
    },
  })

  const conversations = data ?? []

  const remove = async (id: string) => {
    // optimistic
    qc.setQueryData<Conversation[]>(['mentor-conversations'], prev => (prev ?? []).filter(c => c.id !== id))
    try { await fetch(`/api/mentor/conversations/${id}`, { method: 'DELETE' }) }
    catch { qc.invalidateQueries({ queryKey: ['mentor-conversations'] }) }
  }

  return (
    <main className="min-h-screen px-4 pt-14 pb-24" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 20px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <Link href="/mentor" aria-label="Back to Mentor" className="p-1.5 -ml-1.5 text-zinc-400 hover:text-white">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <h1 className="text-2xl font-bold text-white tracking-tight">Chats</h1>
        </div>
        <Link
          href="/mentor"
          className="text-[12.5px] font-bold px-3.5 py-2 rounded-full"
          style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: '#bbf7d0' }}
        >
          + New chat
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: 'rgba(255,255,255,0.03)' }} />
          ))}
        </div>
      )}

      {!isLoading && conversations.length === 0 && (
        <div className="flex flex-col items-center justify-center text-center gap-3 pt-24 px-8">
          <p className="text-sm text-zinc-500 leading-relaxed">No saved chats yet. Start a conversation in Mentor and it&apos;ll show up here.</p>
          <Link href="/mentor" className="text-[13px] font-bold px-4 py-2.5 rounded-full"
            style={{ background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.32)', color: '#bbf7d0' }}>
            Start a chat
          </Link>
        </div>
      )}

      <div className="space-y-2">
        {conversations.map(c => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-2xl pr-2"
            style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <button
              onClick={() => router.push(`/mentor?c=${c.id}`)}
              className="flex-1 min-w-0 text-left px-4 py-3.5"
            >
              <span className="block text-[14px] text-zinc-100 truncate">{c.title || 'Untitled chat'}</span>
              <span className="block text-[11px] text-zinc-600 mt-0.5">{relTime(c.updated_at)}</span>
            </button>
            <button
              onClick={() => remove(c.id)}
              className="p-2 text-zinc-600 hover:text-red-400 shrink-0"
              aria-label="Delete chat"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6" />
              </svg>
            </button>
          </motion.div>
        ))}
      </div>
    </main>
  )
}
