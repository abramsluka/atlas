'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { useExerciseDetail } from '@/features/gym/queries'
import { SPRING_SHEET, EASE_OUT } from './motion'

interface Props {
  id: string | null
  onClose: () => void
}

const cascade = {
  hidden: { opacity: 0, y: 10 },
  show: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.35, ease: EASE_OUT, delay: 0.08 + i * 0.04 },
  }),
}

// The dataset's two photos are the start and end of the movement — crossfading
// them on a loop turns two stills into a looping demo of the exercise.
function DemoPlayer({ urls, name }: { urls: string[]; name: string }) {
  const reduced = useReducedMotion()
  const [frame, setFrame] = useState(0)
  const [paused, setPaused] = useState(false)
  const looping = urls.length > 1 && !paused && !reduced

  useEffect(() => {
    if (!looping) return
    const t = setInterval(() => setFrame(f => (f + 1) % urls.length), 1100)
    return () => clearInterval(t)
  }, [looping, urls.length])

  if (!urls.length) return null

  return (
    <div>
      <div
        className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-white/5"
        onClick={() => setPaused(p => !p)}
      >
        {urls.map((url, i) => (
          <motion.img
            key={url}
            src={url}
            alt={`${name} — ${i === 0 ? 'start' : 'end'} position`}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            initial={false}
            animate={{ opacity: frame === i ? 1 : 0 }}
            transition={{ duration: 0.45, ease: 'easeInOut' }}
          />
        ))}
        {urls.length > 1 && (
          <div className="absolute bottom-2 right-2 text-[9px] font-bold tracking-widest uppercase px-2 py-1 rounded-full bg-black/50 text-white/70 backdrop-blur-sm">
            {paused ? '❚❚' : '▶'} demo
          </div>
        )}
      </div>
      {urls.length > 1 && (
        <div className="flex gap-2 mt-2">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={() => { setFrame(i); setPaused(true) }}
              className="flex-1 text-[9px] font-bold tracking-[0.18em] uppercase py-1.5 rounded-lg transition-colors"
              style={frame === i
                ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.25)' }
                : { background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              {i === 0 ? 'Start' : 'End'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SheetBody({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: detail, isLoading } = useExerciseDetail(id)

  const meta = detail
    ? [detail.equipment, detail.category, detail.level, detail.mechanic, detail.force].filter(Boolean) as string[]
    : []

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={SPRING_SHEET}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose()
        }}
        className="fixed inset-x-0 bottom-0 z-[70] rounded-t-3xl bg-[#111] border-t border-white/10 max-h-[85vh] flex flex-col"
      >
        <div className="shrink-0 pt-3 pb-1 flex justify-center" style={{ touchAction: 'none' }}>
          <div className="w-9 h-1 rounded-full bg-white/15" />
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pb-10">
          {isLoading || !detail ? (
            <div className="space-y-4 py-2 animate-pulse">
              <div className="h-6 w-2/3 rounded-lg bg-white/8" />
              <div className="aspect-[4/3] w-full rounded-2xl bg-white/5" />
              <div className="h-4 w-1/2 rounded bg-white/8" />
              <div className="h-3 w-full rounded bg-white/5" />
              <div className="h-3 w-5/6 rounded bg-white/5" />
            </div>
          ) : (
            <div>
              <motion.div variants={cascade} custom={0} initial="hidden" animate="show"
                className="flex items-start justify-between gap-3 mb-4">
                <h2 className="text-xl font-bold text-white leading-tight">{detail.name}</h2>
                <button onClick={onClose} className="text-white/40 text-2xl leading-none shrink-0">×</button>
              </motion.div>

              <motion.div variants={cascade} custom={1} initial="hidden" animate="show" className="mb-5">
                <DemoPlayer urls={detail.image_urls} name={detail.name} />
              </motion.div>

              <motion.div variants={cascade} custom={2} initial="hidden" animate="show" className="mb-4">
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 mb-2">Muscles</p>
                <div className="flex gap-1.5 flex-wrap">
                  {detail.primary_muscles.map((m, i) => (
                    <motion.span
                      key={m}
                      initial={{ boxShadow: '0 0 0px rgba(74,222,128,0)' }}
                      animate={{ boxShadow: ['0 0 0px rgba(74,222,128,0)', '0 0 14px rgba(74,222,128,0.35)', '0 0 0px rgba(74,222,128,0)'] }}
                      transition={{ duration: 1.4, delay: 0.3 + i * 0.1, ease: 'easeInOut' }}
                      className="text-xs px-2.5 py-1 rounded-full capitalize"
                      style={{ background: 'rgba(74,222,128,0.1)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)' }}
                    >
                      {m}
                    </motion.span>
                  ))}
                  {detail.secondary_muscles.map(m => (
                    <span key={m} className="text-xs px-2.5 py-1 rounded-full capitalize border border-white/15 text-white/50">
                      {m}
                    </span>
                  ))}
                </div>
              </motion.div>

              {meta.length > 0 && (
                <motion.div variants={cascade} custom={3} initial="hidden" animate="show" className="flex gap-1.5 flex-wrap mb-5">
                  {meta.map(m => (
                    <span key={m} className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md bg-white/[0.04] border border-white/10 text-white/40">
                      {m}
                    </span>
                  ))}
                </motion.div>
              )}

              {detail.instructions.length > 0 && (
                <motion.div variants={cascade} custom={4} initial="hidden" animate="show">
                  <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 mb-3">How to do it</p>
                  <ol className="space-y-3">
                    {detail.instructions.map((step, i) => (
                      <motion.li
                        key={i}
                        variants={cascade}
                        custom={5 + i}
                        initial="hidden"
                        animate="show"
                        className="flex gap-3 text-sm text-white/70 leading-relaxed"
                      >
                        <span className="shrink-0 font-mono text-xs mt-0.5" style={{ color: 'rgba(74,222,128,0.5)' }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {step}
                      </motion.li>
                    ))}
                  </ol>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </>
  )
}

export default function ExerciseInfoSheet({ id, onClose }: Props) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {id && <SheetBody key={id} id={id} onClose={onClose} />}
    </AnimatePresence>,
    document.body
  )
}
