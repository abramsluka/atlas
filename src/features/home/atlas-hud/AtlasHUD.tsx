'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view. Full-screen <Canvas> hosting the 3D scene.
 *
 * Code-split via next/dynamic (ssr:false) from HomeClient. `onExit` flips back
 * to the dashboard; `onNavigate` routes to a module.
 *
 * TEMP DIAGNOSTIC: surfaces WebGL context / shader errors on-screen (red box)
 * so we can debug the mobile black-screen without devtools. Remove once fixed.
 */
export default function AtlasHUD({ onExit }: { onExit: () => void }) {
  const router = useRouter()
  const [diag, setDiag] = useState<string[]>([])
  const [glInfo, setGlInfo] = useState('')

  useEffect(() => {
    const orig = console.error
    console.error = (...args: unknown[]) => {
      const msg = args.map((a) => (typeof a === 'string' ? a : (a as Error)?.message ?? String(a))).join(' ')
      setDiag((d) => [...d, msg.slice(0, 700)].slice(-12))
      orig.apply(console, args as [])
    }
    const onErr = (e: ErrorEvent) => setDiag((d) => [...d, 'JS ERR: ' + (e.message || String(e.error))].slice(-12))
    window.addEventListener('error', onErr)
    return () => { console.error = orig; window.removeEventListener('error', onErr) }
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
          const ver = typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1'
          setGlInfo(`ctx ${ver} · dpr ${gl.getPixelRatio()}`)
          const canvas = gl.domElement
          canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setDiag((d) => [...d, '⚠ WEBGL CONTEXT LOST'].slice(-12)) })
          canvas.addEventListener('webglcontextcreationerror', (e) => setDiag((d) => [...d, 'CTX CREATE ERR: ' + ((e as WebGLContextEvent).statusMessage || '')].slice(-12)))
        }}
      >
        <Scene onExit={onExit} onNavigate={(href) => router.push(href)} />
      </Canvas>
      <HudOverlay />

      {diag.length > 0 && (
        <div style={{
          position: 'fixed', left: 8, right: 8, bottom: 76, zIndex: 9999, maxHeight: '45vh', overflow: 'auto',
          background: 'rgba(20,2,2,0.9)', border: '1px solid #f66', borderRadius: 8, padding: 8,
          font: '10px/1.4 ui-monospace, Menlo, monospace', color: '#ffc2c2', whiteSpace: 'pre-wrap', pointerEvents: 'auto',
        }}>
          <div style={{ color: '#9fe8ff', marginBottom: 4 }}>HUD DIAG · {glInfo || '…'}</div>
          {diag.length === 0 ? <div style={{ color: '#6f6' }}>no errors captured</div> : diag.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
    </div>
  )
}
