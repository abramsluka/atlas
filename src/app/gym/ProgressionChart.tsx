'use client'

// Progression chart for the Exercise History sheet — hand-rolled inline SVG
// (house convention, no chart lib). Design locked in specs/gym/exercise-history-lab.html:
// hollow ringed dots on short ranges (≤16 sessions), line-only beyond (Apple-stocks
// scrub), timeframe-scoped caption, tooltip clamped inside the frame.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import type { ExerciseSession, Timeframe } from '@/features/gym/history'
import { TIMEFRAMES, TIMEFRAME_LABEL, chartSessions, windowDelta, fmtSessionDate } from '@/features/gym/history'
import { SPRING_SNAPPY } from './motion'

const EASE_OUT = [0.16, 1, 0.3, 1] as const
const VW = 340
const VH = 170
const PAD = { l: 30, r: 12, t: 14, b: 20 }
const GREEN = '#4ade80'
const RED = '#f87171'
const SMOOTH = 0.65

interface Props {
  sessions: ExerciseSession[]   // all sessions (chartSessions filters swapped + window)
  bodyweight: boolean
  units: string
  step: number
  tf: Timeframe
  onTfChange: (tf: Timeframe) => void
}

interface Pt { x: number; y: number; s: ExerciseSession }

// Catmull-Rom → cubic bezier, same technique as WtChart
function smoothPath(pts: Pt[], k: number): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : ''
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6 * k, c1y = p1.y + (p2.y - p0.y) / 6 * k
    const c2x = p2.x - (p3.x - p1.x) / 6 * k, c2y = p2.y - (p3.y - p1.y) / 6 * k
    d += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`
  }
  return d
}

// Rolls the displayed number toward its target over ~200ms (scrub feel).
function useRolledNumber(target: number, snap: number): number {
  const [shown, setShown] = useState(target)
  const raf = useRef(0)
  useEffect(() => {
    const from = shown
    if (from === target) return
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 200)
      const e = 1 - Math.pow(1 - k, 3)
      const val = from + (target - from) * e
      setShown(k < 1 ? Math.round(val / snap) * snap : target)
      if (k < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  return shown
}

const fmtNum = (n: number) => String(+n.toFixed(2)).replace(/\.0+$/, '')

export default function ProgressionChart({ sessions, bodyweight, units, step, tf, onTfChange }: Props) {
  const reduced = useReducedMotion()
  const boxRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => chartSessions(sessions, tf), [sessions, tf])

  const pts = useMemo<Pt[]>(() => {
    if (!visible.length) return []
    const ws = visible.map(s => s.topWeight)
    let mn = Math.min(...ws), mx = Math.max(...ws)
    if (mn === mx) { mn -= step * 2; mx += step * 2 }
    else { const pad = (mx - mn) * 0.18 || step; mn -= pad; mx += pad }
    const t0 = visible[0].date.getTime(), t1 = visible[visible.length - 1].date.getTime()
    const xOf = (t: number) => visible.length === 1 ? VW / 2 : PAD.l + (t - t0) / (t1 - t0 || 1) * (VW - PAD.l - PAD.r)
    const yOf = (w: number) => VH - PAD.b - (w - mn) / (mx - mn) * (VH - PAD.t - PAD.b)
    return visible.map(s => ({ x: xOf(s.date.getTime()), y: yOf(s.topWeight), s }))
  }, [visible, step])

  const domain = useMemo(() => {
    if (!visible.length) return { mn: 0, mx: 1 }
    const ws = visible.map(s => s.topWeight)
    let mn = Math.min(...ws), mx = Math.max(...ws)
    if (mn === mx) { mn -= step * 2; mx += step * 2 }
    else { const pad = (mx - mn) * 0.18 || step; mn -= pad; mx += pad }
    return { mn, mx }
  }, [visible, step])

  // Active (scrubbed) point — defaults to the latest session
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const idx = activeIdx !== null && activeIdx < pts.length ? activeIdx : pts.length - 1
  const active = pts[idx] ?? null
  useEffect(() => { setActiveIdx(null) }, [tf, sessions.length])

  function scrubTo(clientX: number) {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || !pts.length) return
    const xv = (clientX - rect.left) / rect.width * VW
    let best = 0, bd = Infinity
    pts.forEach((p, i) => { const d = Math.abs(p.x - xv); if (d < bd) { bd = d; best = i } })
    setActiveIdx(best)
  }

  // Clamp the tooltip inside the frame so edge sessions never clip
  const [tipX, setTipX] = useState(0)
  useLayoutEffect(() => {
    const box = boxRef.current, tip = tipRef.current
    if (!box || !tip || !active) return
    const scale = box.clientWidth / VW
    const half = tip.offsetWidth / 2
    setTipX(Math.max(half + 4, Math.min(box.clientWidth - half - 4, active.x * scale)))
  }, [active, idx])

  const rolledTop = useRolledNumber(active?.s.topWeight ?? 0, bodyweight ? 1 : (step || 2.5))

  const delta = windowDelta(visible)
  const unit = bodyweight ? 'reps' : units
  const dotR = pts.length <= 16 ? (pts.length <= 8 ? 3.4 : 3.0) : 0
  const lineD = smoothPath(pts, SMOOTH)
  const areaD = pts.length > 1
    ? `${lineD} L${pts[pts.length - 1].x},${VH - PAD.b} L${pts[0].x},${VH - PAD.b} Z`
    : ''
  const activeDelta = active?.s.deltaWeight ?? null

  const gridLines = useMemo(() => {
    const { mn, mx } = domain
    return [0, 1, 2].map(g => {
      const w = mn + (mx - mn) * (g + 0.5) / 3
      return { y: VH - PAD.b - (w - mn) / (mx - mn) * (VH - PAD.t - PAD.b), label: fmtNum(Math.round(w / (step || 2.5)) * (step || 2.5)) }
    })
  }, [domain, step])

  return (
    <div>
      {/* Timeframe chooser */}
      <div className="flex gap-0.5 rounded-xl p-1 mb-3" style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {TIMEFRAMES.map(k => (
          <button
            key={k}
            onClick={() => onTfChange(k)}
            className="relative flex-1 py-1.5 text-[11px] font-mono tracking-wider rounded-lg"
            style={{ color: tf === k ? '#08120b' : 'rgba(255,255,255,0.4)' }}
          >
            {tf === k && (
              <motion.span
                layoutId="tf-active-pill"
                transition={reduced ? { duration: 0 } : SPRING_SNAPPY}
                className="absolute inset-0 rounded-lg"
                style={{ background: GREEN, boxShadow: '0 4px 14px -4px rgba(74,222,128,0.6)' }}
              />
            )}
            <span className={`relative z-10 ${tf === k ? 'font-semibold' : ''}`}>{k}</span>
          </button>
        ))}
      </div>

      {/* Chart */}
      <div
        ref={boxRef}
        className="relative"
        style={{ touchAction: 'pan-y' }}
        onPointerMove={e => scrubTo(e.clientX)}
        onPointerDown={e => scrubTo(e.clientX)}
        onPointerLeave={() => setActiveIdx(null)}
      >
        <svg viewBox={`0 0 ${VW} ${VH}`} className="block w-full h-auto overflow-visible">
          <defs>
            <linearGradient id="ph-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={GREEN} stopOpacity="0.32" />
              <stop offset="1" stopColor={GREEN} stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((g, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={VW - PAD.r} y1={g.y} y2={g.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={2} y={g.y + 3} fill="rgba(255,255,255,0.22)" fontSize="8.5" fontFamily="monospace">{g.label}</text>
            </g>
          ))}

          {areaD && (
            <motion.path
              key={`a-${tf}-${pts.length}`}
              d={areaD}
              fill="url(#ph-area)"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: reduced ? 0 : 0.6, ease: EASE_OUT }}
            />
          )}

          {pts.length > 1 && (
            <motion.path
              key={`l-${tf}-${pts.length}`}
              d={lineD}
              fill="none"
              stroke={GREEN}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={reduced ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={reduced ? { duration: 0 } : { duration: 1.1, ease: EASE_OUT }}
              style={{ filter: 'drop-shadow(0 3px 8px rgba(74,222,128,0.14))' }}
            />
          )}

          {/* hollow ringed dots — short ranges only (≤16); line-only beyond */}
          {dotR > 0 && pts.map((p, i) => (
            <motion.circle
              key={`${tf}-${p.s.dateKey}`}
              cx={p.x} cy={p.y} r={dotR}
              fill="#111" stroke={GREEN} strokeWidth="2"
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={reduced ? { duration: 0 } : { ...SPRING_SNAPPY, delay: 0.15 + 1.1 * ((p.x - PAD.l) / (VW - PAD.l - PAD.r)) }}
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              opacity={i === idx ? 0 : 1}
            />
          ))}

          {/* crosshair + active dot */}
          {active && (
            <g>
              <line
                x1={active.x} x2={active.x} y1={PAD.t} y2={VH - PAD.b}
                stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="3 4"
              />
              <circle cx={active.x} cy={active.y} r={9} fill={GREEN} opacity={0.16} />
              <circle cx={active.x} cy={active.y} r={4.6} fill={GREEN} />
            </g>
          )}

          {/* x-axis: first + last visible date */}
          {pts.length > 0 && (
            <>
              <text x={PAD.l} y={VH - 5} fill="rgba(255,255,255,0.22)" fontSize="9" fontStyle="italic" fontFamily="serif">
                {fmtSessionDate(pts[0].s.dateKey)}
              </text>
              <text x={VW - PAD.r} y={VH - 5} textAnchor="end" fill="rgba(255,255,255,0.22)" fontSize="9" fontStyle="italic" fontFamily="serif">
                {fmtSessionDate(pts[pts.length - 1].s.dateKey)}
              </text>
            </>
          )}
        </svg>

        {/* tooltip — clamped inside the frame */}
        {active && (
          <div
            ref={tipRef}
            className="absolute pointer-events-none whitespace-nowrap rounded-[10px] px-2.5 py-1.5 text-[11px]"
            style={{
              left: tipX,
              top: `${(active.y / VH) * 100}%`,
              transform: 'translate(-50%, -118%)',
              background: 'rgba(10,12,14,0.92)',
              border: '1px solid rgba(255,255,255,0.1)',
              boxShadow: '0 10px 30px -12px rgba(0,0,0,0.9)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span className="font-serif italic text-white/45 mr-1.5">{fmtSessionDate(active.s.dateKey)}</span>
            <span className="font-bold text-white">{fmtNum(rolledTop)} {unit}</span>
            <span className="text-white/45 ml-1">{active.s.setCount} × {active.s.repsAtTop} reps</span>
            {activeDelta !== null ? (
              <span className="ml-1.5 font-semibold" style={{ color: activeDelta >= 0 ? GREEN : RED }}>
                {activeDelta > 0 ? '▲ +' : activeDelta < 0 ? '▼ ' : ''}{activeDelta === 0 ? '—' : fmtNum(Math.abs(activeDelta))}
              </span>
            ) : (
              <span className="ml-1.5 text-white/30">first</span>
            )}
          </div>
        )}
      </div>

      {/* timeframe-scoped caption */}
      {delta !== null && (
        <p className="text-center font-serif italic text-[13px] mt-2" style={{ color: GREEN, opacity: 0.9 }}>
          {delta >= 0 ? '+' : ''}{fmtNum(delta)} {unit} · {TIMEFRAME_LABEL[tf]}
        </p>
      )}

      {/* selected session's set pills */}
      {active && (
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="font-serif italic text-[11px] text-white/45 mr-0.5">{fmtSessionDate(active.s.dateKey)}</span>
          {active.s.sets.slice(0, 8).map((set, i) => (
            <span
              key={set.id ?? i}
              className="min-w-[26px] text-center font-mono text-[11px] py-1 rounded-[7px]"
              style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', color: GREEN }}
            >
              {set.reps}
            </span>
          ))}
          {active.s.sets.length > 8 && <span className="text-[10px] text-white/30">+{active.s.sets.length - 8}</span>}
          <span className="ml-auto font-mono text-[10px] tracking-[0.12em] text-white/40">{active.s.totalReps} REPS</span>
        </div>
      )}
    </div>
  )
}
