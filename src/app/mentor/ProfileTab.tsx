'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useProfileFacts } from '@/features/profile/queries'
import { useCreateFact, useDeleteFact, useUpdateFact } from '@/features/profile/mutations'
import { FACT_CATEGORIES, type FactCategory, type ProfileFactWithSource } from '@/lib/profile/types'

const CAT_LABEL: Record<FactCategory, string> = {
  identity: 'Identity',
  goals: 'Goals',
  training: 'Training',
  nutrition: 'Nutrition',
  health: 'Health',
  relationships: 'Relationships',
  work: 'Work',
  values: 'Values',
  preferences: 'Preferences',
  struggles: 'Struggles',
}

const CAT_COLOR: Record<FactCategory, string> = {
  identity: '#a78bfa',
  goals: '#fbbf24',
  training: '#4ade80',
  nutrition: '#22d3ee',
  health: '#818cf8',
  relationships: '#f472b6',
  work: '#94a3b8',
  values: '#c084fc',
  preferences: '#2dd4bf',
  struggles: '#fb923c',
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function SourceLine({ fact }: { fact: ProfileFactWithSource }) {
  const when = formatDate(fact.source_date ?? fact.first_seen_at)

  if (fact.source_kind === 'journal' && fact.source_id) {
    return (
      <Link href={`/journal/${fact.source_id}`} className="text-[10.5px] text-zinc-600 hover:text-zinc-400 transition-colors">
        from your journal{when ? `, ${when}` : ''}
      </Link>
    )
  }
  if (fact.source_kind === 'mentor') {
    return <span className="text-[10.5px] text-zinc-600">from a Mentor conversation{when ? `, ${when}` : ''}</span>
  }
  if (fact.source_kind === 'manual') {
    return <span className="text-[10.5px] text-zinc-600">added by you</span>
  }
  return <span className="text-[10.5px] text-zinc-600">from your earlier profile</span>
}

function FactRow({ fact }: { fact: ProfileFactWithSource }) {
  const update = useUpdateFact()
  const remove = useDeleteFact()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(fact.content)

  const pinned = fact.status === 'pinned'
  const color = CAT_COLOR[fact.category]

  const save = () => {
    const next = draft.trim()
    if (next && next !== fact.content) update.mutate({ id: fact.id, content: next })
    setEditing(false)
  }

  return (
    <div
      className="rounded-2xl p-3.5"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderLeft: `2px solid ${color}` }}
    >
      {editing ? (
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          autoFocus
          rows={3}
          className="w-full bg-transparent text-[13px] text-zinc-100 leading-relaxed outline-none resize-none"
        />
      ) : (
        <p className="text-[13px] text-zinc-200 leading-relaxed">{fact.content}</p>
      )}

      <div className="flex items-center gap-2.5 mt-2">
        <SourceLine fact={fact} />
        <div className="ml-auto flex items-center gap-2.5">
          <button
            onClick={() => update.mutate({ id: fact.id, status: pinned ? 'active' : 'pinned' })}
            className="text-[10px] font-bold tracking-[0.12em] uppercase transition-colors"
            style={{ color: pinned ? color : 'rgba(255,255,255,0.25)' }}
            aria-label={pinned ? 'Unpin fact' : 'Pin fact'}
          >
            {pinned ? 'pinned' : 'pin'}
          </button>
          <button
            onClick={() => { setDraft(fact.content); setEditing(true) }}
            className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            edit
          </button>
          <button
            onClick={() => remove.mutate(fact.id)}
            className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-600 hover:text-red-400 transition-colors"
          >
            forget
          </button>
        </div>
      </div>
    </div>
  )
}

function AddFact() {
  const create = useCreateFact()
  const [open, setOpen] = useState(false)
  const [content, setContent] = useState('')
  const [category, setCategory] = useState<FactCategory>('identity')

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl py-3 text-[11px] font-bold tracking-[0.15em] uppercase text-zinc-600 hover:text-zinc-400 transition-colors"
        style={{ border: '1px dashed rgba(255,255,255,0.1)' }}
      >
        add something Atlas should know
      </button>
    )
  }

  const submit = () => {
    const next = content.trim()
    if (!next) { setOpen(false); return }
    create.mutate({ category, content: next })
    setContent('')
    setOpen(false)
  }

  return (
    <div className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Something true about you that Atlas keeps missing."
        autoFocus
        rows={2}
        className="w-full bg-transparent text-[13px] text-zinc-100 leading-relaxed outline-none resize-none placeholder:text-zinc-700"
      />
      <div className="flex items-center gap-2 mt-2">
        <select
          value={category}
          onChange={e => setCategory(e.target.value as FactCategory)}
          className="bg-white/5 text-[11px] text-zinc-300 rounded px-2 py-1 outline-none"
        >
          {FACT_CATEGORIES.map(c => <option key={c} value={c} className="bg-zinc-900">{CAT_LABEL[c]}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2.5">
          <button onClick={() => { setOpen(false); setContent('') }} className="text-[10px] font-bold tracking-[0.12em] uppercase text-zinc-600">
            cancel
          </button>
          <button onClick={submit} className="text-[10px] font-bold tracking-[0.12em] uppercase text-white">
            save
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProfileTab() {
  const { data, isLoading, isError } = useProfileFacts()

  const { durable, state } = useMemo(() => {
    const facts = data?.facts ?? []
    return {
      durable: facts.filter(f => f.tier === 'durable'),
      state: facts.filter(f => f.tier === 'state'),
    }
  }, [data?.facts])

  if (isLoading) {
    return (
      <div className="space-y-3 pt-2">
        {[0, 1, 2].map(i => <div key={i} className="h-20 rounded-2xl bg-white/[0.03] border border-white/5 animate-pulse" />)}
      </div>
    )
  }

  if (isError) {
    return <p className="text-sm text-zinc-500 text-center py-16">Couldn’t load your profile. Pull back in a moment.</p>
  }

  if (!durable.length && !state.length) {
    return (
      <div className="text-center py-16 px-6">
        <p className="text-sm text-zinc-400 leading-relaxed">Atlas doesn’t know you yet.</p>
        <p className="text-[12.5px] text-zinc-600 mt-2 leading-relaxed">
          This fills in on its own as you journal and talk to Mentor. Everything here is editable, and anything you forget is gone from every AI response in the app.
        </p>
      </div>
    )
  }

  return (
    <div className="pt-1 pb-6">
      <p className="text-[12px] text-zinc-500 mb-4 leading-relaxed">
        What Atlas remembers about you, built from your journal and your conversations. Every AI in the app answers from this.
      </p>

      {state.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-zinc-500">Right now</span>
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
          </div>
          <div className="rounded-2xl p-3.5 space-y-1.5" style={{ background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.09)' }}>
            {state.map(f => <p key={f.id} className="text-[13px] text-zinc-300 leading-relaxed">{f.content}</p>)}
            <p className="text-[10.5px] text-zinc-600 pt-1">Recomputed weekly from the last 14 days.</p>
          </div>
        </div>
      )}

      {FACT_CATEGORIES.map(cat => {
        const group = durable.filter(f => f.category === cat)
        if (!group.length) return null
        return (
          <div key={cat} className="mb-5">
            <div className="flex items-center gap-2 mb-2.5">
              <span className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: CAT_COLOR[cat] }}>{CAT_LABEL[cat]}</span>
              <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.08), transparent)' }} />
            </div>
            <div className="space-y-2.5">
              {group.map(f => <FactRow key={f.id} fact={f} />)}
            </div>
          </div>
        )
      })}

      <AddFact />
    </div>
  )
}
