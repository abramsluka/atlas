'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import { Component, useEffect, useState, type ReactNode } from 'react'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view. Full-screen <Canvas> hosting the 3D scene.
 *
 * Wrapped in an error boundary so a render/WebGL crash surfaces a message
 * instead of a silent black canvas. TEMP on-screen diagnostic (DIAG marker +
 * captured shader/JS errors) — remove once the mobile issue is confirmed fixed.
 */
class SceneBoundary extends Component<{ onError: (m: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: Error) { this.props.onError('SCENE CRASH: ' + (err?.message || String(err))) }
  render() { return this.state.failed ? null : this.props.children }
}

export default function AtlasHUD({ onExit }: { onExit: () => void }) {
  const router = useRouter()
  const [diag, setDiag] = useState<string[]>([])
  const [info, setInfo] = useState('init')

  useEffect(() => {
    const orig = console.error
    console.error = (...a: unknown[]) => {
      const m = a.map((x) => (typeof x === 'string' ? x : (x as Error)?.message ?? String(x))).join(' ')
      setDiag((d) => [...d, 'ERR: ' + m.slice(0, 700)].slice(-16))
      orig.apply(console, a as [])
    }
    const onErr = (e: ErrorEvent) => setDiag((d) => [...d, 'JS: ' + (e.message || String(e.error))].slice(-16))
    const onRej = (e: PromiseRejectionEvent) =>
      setDiag((d) => [...d, 'REJECT: ' + String((e.reason as Error)?.message ?? e.reason)].slice(-16))
    window.addEventListener('error', onErr)
    window.addEventListener('unhandledrejection', onRej)

    // Probe the Earth textures: confirms whether /textures/* serves a PNG or gets
    // auth-redirected to /login HTML (which would silently suspend/break the globe).
    ;['/textures/earth-water.png', '/textures/earth-topology.png'].forEach((u) => {
      fetch(u, { cache: 'no-store' })
        .then((r) => setDiag((d) => [...d, `TEX ${u.split('/').pop()}: ${r.status} ${r.headers.get('content-type')}`].slice(-16)))
        .catch((err) => setDiag((d) => [...d, `TEX ${u} FAIL ${String(err)}`].slice(-16)))
    })

    return () => {
      console.error = orig
      window.removeEventListener('error', onErr)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <SceneBoundary onError={(m) => setDiag((d) => [...d, m].slice(-12))}>
        <Canvas
          flat
          camera={{ position: [0, 0.7, 9.5], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          onCreated={({ gl }) => {
            const ctx = gl.getContext()
            const ver = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? 'GL2' : 'GL1'
            setInfo(`${ver} dpr${gl.getPixelRatio().toFixed(1)}`)
            gl.debug.checkShaderErrors = true
            gl.debug.onShaderError = (glc, program, vs, fs) => {
              const flog = glc.getShaderInfoLog(fs) || ''
              const vlog = glc.getShaderInfoLog(vs) || ''
              const plog = glc.getProgramInfoLog(program) || ''
              setDiag((d) => [...d, ('SHADER: ' + (flog || vlog || plog || '?')).slice(0, 600)].slice(-12))
            }
            gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setDiag((d) => [...d, '⚠ CONTEXT LOST'].slice(-12)) })
          }}
        >
          <Scene onExit={onExit} onNavigate={(href) => router.push(href)} />
        </Canvas>
      </SceneBoundary>
      <HudOverlay />

      {/* always-on marker — TOP (the bottom is covered by the tab bar) */}
      <div style={{
        position: 'fixed', left: 8, top: 54, zIndex: 99999, pointerEvents: 'none',
        font: '12px ui-monospace, Menlo, monospace', color: '#5fd8ff',
        background: 'rgba(0,0,0,0.75)', padding: '4px 8px', borderRadius: 5,
      }}>
        DIAG7 · {info} · {diag.length} err
      </div>

      {diag.length > 0 && (
        <div style={{
          position: 'fixed', left: 8, right: 8, top: 84, zIndex: 99999, maxHeight: '60vh', overflow: 'auto',
          background: 'rgba(20,2,2,0.94)', border: '1px solid #f66', borderRadius: 8, padding: 8,
          font: '10px/1.4 ui-monospace, Menlo, monospace', color: '#ffc2c2', whiteSpace: 'pre-wrap', pointerEvents: 'auto',
        }}>
          {diag.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
    </div>
  )
}
