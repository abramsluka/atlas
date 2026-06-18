'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view. Full-screen <Canvas> hosting the 3D scene.
 *
 * TEMP DIAGNOSTIC (remove once mobile is fixed): a tiny always-on status pill
 * confirms this build is live + shows WebGL version, and any shader/context
 * error is printed on-screen — so we can debug the mobile black-screen without
 * devtools. Shader errors are caught at the source via gl.debug.onShaderError.
 */
export default function AtlasHUD({ onExit }: { onExit: () => void }) {
  const router = useRouter()
  const [diag, setDiag] = useState<string[]>([])
  const [info, setInfo] = useState('init')

  useEffect(() => {
    const orig = console.error
    console.error = (...a: unknown[]) => {
      const m = a.map((x) => (typeof x === 'string' ? x : (x as Error)?.message ?? String(x))).join(' ')
      if (/shader|webgl|program|gl_|compile|context/i.test(m)) setDiag((d) => [...d, m.slice(0, 600)].slice(-12))
      orig.apply(console, a as [])
    }
    return () => { console.error = orig }
  }, [])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
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
      <HudOverlay />

      {/* always-on marker — confirms THIS build is live + WebGL version */}
      <div style={{
        position: 'fixed', left: 8, bottom: 80, zIndex: 9999, pointerEvents: 'none',
        font: '9px ui-monospace, Menlo, monospace', color: '#5fd8ff',
        background: 'rgba(0,0,0,0.55)', padding: '2px 6px', borderRadius: 5,
      }}>
        DIAG5 · {info} · {diag.length} err
      </div>

      {diag.length > 0 && (
        <div style={{
          position: 'fixed', left: 8, right: 8, bottom: 100, zIndex: 9999, maxHeight: '42vh', overflow: 'auto',
          background: 'rgba(20,2,2,0.92)', border: '1px solid #f66', borderRadius: 8, padding: 8,
          font: '10px/1.4 ui-monospace, Menlo, monospace', color: '#ffc2c2', whiteSpace: 'pre-wrap', pointerEvents: 'auto',
        }}>
          {diag.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
    </div>
  )
}
