'use client'

import { Canvas } from '@react-three/fiber'
import { useRouter } from 'next/navigation'
import Scene from './Scene'
import HudOverlay from './HudOverlay'

/**
 * Top-level Atlas HUD view. Full-screen <Canvas> hosting the 3D scene.
 *
 * Code-split via next/dynamic (ssr:false) from HomeClient, so Three.js never
 * enters the main bundle — it only loads when the user opens the map view.
 *
 * Navigation lives here (outside the Canvas — React context doesn't cross the
 * r3f boundary): `onExit` flips the map/list toggle back to the bento dashboard
 * (clicking the center Atlas planet), and `onNavigate` routes to a module
 * (clicking a satellite planet).
 *
 * No post-processing: the EffectComposer black-flashed on this GPU, so glow is
 * done with per-element additive shells instead (see spec §9.1). antialias is ON
 * again since there's no composer to conflict with it.
 */
export default function AtlasHUD({ onExit }: { onExit: () => void }) {
  const router = useRouter()

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Canvas
        flat
        camera={{ position: [0, 0.6, 10], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Scene onExit={onExit} onNavigate={(href) => router.push(href)} />
      </Canvas>
      <HudOverlay />
    </div>
  )
}
