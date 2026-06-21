'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view: a full-screen <Canvas> hosting the 3D scene (the
 * holographic Atlas globe + orbiting module planets) with the HUD panel overlay
 * layered on top. Clicking the globe exits back to the bento dashboard.
 */
export default function AtlasHUD({ onExit }: { onExit: () => void }) {
  const router = useRouter()

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Canvas
        flat
        camera={{ position: [0, 0.7, 9.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Scene onExit={onExit} onNavigate={(href) => router.push(href)} />
      </Canvas>
      <HudOverlay />
    </div>
  )
}
