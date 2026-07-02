'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useInsights, usePinInsight } from '@/features/mentor/insightQueries'
import type { Insight, InsightCategory } from '@/lib/computeCorrelations'

const CAT: Record<InsightCategory, { label: string; color: string }> = {
  sleep: { label: 'Sleep', color: '#818cf8' },
  training: { label: 'Training', color: '#4ade80' },
  lifestyle: { label: 'Lifestyle', color: '#22d3ee' },
  mood: { label: 'Mood', color: '#fbbf24' },
}
const CAT_ORDER: InsightCategory[] = ['sleep', 'training', 'lifestyle', 'mood']

function MiniBars({ data, color }: { data: NonNullable<Insight['chartData']>; color: string }) {
  const max = Math.max(...data.map(d => Math.abs(d.value)), 1)
  return (
    <div className="space-y-1 mt-2.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500 w-[80px] shrink-0 truncate text-right">{d.label}</span>
          <div className="flex-1 h-[15px] rounded bg-white/5 overflow-hidden">
            <motion.div className="h-full rounded"
              initial={{ width: 0 }} animate={{ width: `${Math.max(4, (Math.abs(d.value) / max) * 100)}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              style={{ background: color, opacity: 0.55 }} />
          </div>
          <span className="text-[10.5px] text-zinc-300 tabular-nums w-[46px] shrink-0">{d.value}{d.unit ?? ''}</span>
        </div>
      ))}
    </div>
  )
}

function InsightCard({ insight, pinned, onPin }: { insight: Insight; pinned: boolean; onPin: (id: string, next: boolean) => void }) {
  const cat = CAT[insight.category]
  return (
    <div className="rounded-2xl p-3.5 relative" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderLeft: `2px solid ${cat.color}` }}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[9px] font-extrabold tracking-[0.2em] uppercase" style={{ color: cat.color }}>{cat.label}</span>
        <button onClick={() => onPin(insight.id, !pinned)} className="-mt-0.5 -mr-0.5 p-0.5 active:opacity-60" aria-label={pinned ? 'Unpin' : 'Pin'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={pinned ? cat.color : 'none'} stroke={pinned ? cat.color : 'rgba(255,255,255,0.3)'} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5.9 20.4l1.4-6.8L2.2 9l6.9-.7z" />
          </svg>
        </button>
      </div>
      <h3 className="text-[14px] font-bold text-zinc-100 mt-1 leading-snug">{insight.title}</h3>
      <p className="text-[12.5px] text-zinc-400 mt-1 leading-relaxed">{insight.body}</p>
      {insight.chartData && <MiniBars data={insight.chartData} color={cat.color} />}
      <div className="flex items-center gap-2 mt-2.5">
        <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase px-1.5 py-0.5 rounded" style={{ color: cat.color, background: `${cat.color}14` }}>
          {insight.magnitude}
        </span>
        <span className="text-[10.5px] text-zinc-600">based on {insight.dataPoints} days</span>
      </div>
    </div>
  )
}

export default function InsightsTab() {
  const { data, isLoading, isError } = useInsights(true)
  const pin = usePinInsight()

  const pinnedSet = useMemo(() => new Set(data?.pinnedIds ?? []), [data?.pinnedIds])
  const handlePin = (id: string, next: boolean) => pin.mutate({ insight_id: id, pinned: next })

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {[0, 1, 2].map(i => <div key={i} className="h-32 rounded-2xl bg-white/[0.03] border border-white/5 animate-pulse" />)}
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-zinc-500 text-center py-16">Couldn’t load insights. Pull back in a moment.</p>
  }

  const insights = data?.insights ?? []
  if (!insights.length) {
    return (
      <div className="text-center py-16 px-6">
        <p className="text-sm text-zinc-400 leading-relaxed">Not enough data yet to spot patterns.</p>
        <p className="text-[12.5px] text-zinc-600 mt-2 leading-relaxed">Keep logging sleep, training, caffeine, water, and mood. Once there are ~10 overlapping days, Atlas starts surfacing correlations here.</p>
      </div>
    )
  }

  const pinned = insights.filter(i => pinnedSet.has(i.id))
  const rest = insights.filter(i => !pinnedSet.has(i.id))

  return (
    <div className="pt-1 pb-6">
      <p className="text-[12px] text-zinc-500 mb-4 leading-relaxed">Patterns Atlas found across your data. Pure math on what you’ve logged — no guessing.</p>

      {pinned.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Pinned</span>
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
          </div>
          <div className="space-y-2.5">
            {pinned.map(i => <InsightCard key={i.id} insight={i} pinned onPin={handlePin} />)}
          </div>
        </div>
      )}

      {CAT_ORDER.map(catKey => {
        const group = rest.filter(i => i.category === catKey)
        if (!group.length) return null
        return (
          <div key={catKey} className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: CAT[catKey].color }}>{CAT[catKey].label}</span>
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
            </div>
            <div className="space-y-2.5">
              {group.map(i => <InsightCard key={i.id} insight={i} pinned={pinnedSet.has(i.id)} onPin={handlePin} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
