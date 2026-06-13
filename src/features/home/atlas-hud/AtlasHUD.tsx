'use client'

import { Canvas } from '@react-three/fiber'
import Scene from './Scene'

/**
 * Top-level Atlas HUD view. Full-screen <Canvas> hosting the 3D scene.
 *
 * This whole module is code-split via next/dynamic (ssr:false) from HomeClient,
 * so Three.js never enters the main bundle — it only loads when the user opens
 * the map view. The crisp DOM/SVG HUD overlay (day arc, stat panel, Today's
 * Call, radar) is added on top in Phase 4.
 */
export default function AtlasHUD() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <Canvas
        camera={{ position: [0, 0.6, 8.5], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Scene />
      </Canvas>
    </div>
  )
}
