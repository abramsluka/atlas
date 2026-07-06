'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view: a full-screen <Canvas> hosting the 3D scene (the
 * holographic Atlas globe + orbiting module planets) with the HUD panel overlay
 * layered on top. Exit back to the bento dashboard via the top-right toggle button.
 */
export default function AtlasHUD() {
  const router = useRouter()

  return (
    // grab/grabbing cursor signals the drag-to-orbit affordance; HUD panels set
    // their own cursor so the hand only shows over draggable space.
    // data-ptr-block: pull-to-refresh must never engage inside the HUD — its
    // wrapper transform collapses this fixed canvas to a black screen.
    <div
      data-ptr-block=""
      style={{ position: 'fixed', inset: 0, background: '#000', cursor: 'grab' }}
      onPointerDown={(e) => { e.currentTarget.style.cursor = 'grabbing' }}
      onPointerUp={(e) => { e.currentTarget.style.cursor = 'grab' }}
      onPointerLeave={(e) => { e.currentTarget.style.cursor = 'grab' }}
    >
      <Canvas
        flat
        camera={{ position: [0, 0.7, 9.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Scene onNavigate={(href) => router.push(href)} />
      </Canvas>
      <HudOverlay />
    </div>
  )
}
