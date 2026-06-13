'use client'

import { useRef } from 'react'
import { Stars } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import type { Group } from 'three'
import AtlasPlanet from './AtlasPlanet'
import { useParallax } from './useParallax'

/**
 * The r3f scene: lights, starfield, the parallax-tilting world group (holding
 * the Atlas planet), and post-processing bloom.
 *
 * Phase 1 scaffold — Atlas planet only. Satellites (Phase 3) and the two-tier
 * selective bloom (spec §9.1) come later; for now a single subtle global bloom.
 */
export default function Scene() {
  const world = useRef<Group>(null)
  useParallax(world)

  return (
    <>
      {/* Lights are inert for the unlit holo shader, but ready for the
          StandardMaterial satellites added in Phase 3. */}
      <ambientLight color="#223344" intensity={0.6} />
      <directionalLight color="#9fd8ff" intensity={2.0} position={[4, 3, 5]} />
      <directionalLight color="#3a6cff" intensity={1.2} position={[-5, -2, -3]} />

      <Stars radius={50} depth={40} count={1400} factor={3} saturation={0} fade speed={0.5} />

      <group ref={world}>
        <AtlasPlanet />
      </group>

      {/* Phase 1 bloom: single global pass, kept subtle. Exact two-tier
          tuning (planets ~0.21 vs labels ~0.1) lands in Phase 2/3 per §9.1. */}
      <EffectComposer>
        <Bloom intensity={0.5} luminanceThreshold={0.15} luminanceSmoothing={0.7} mipmapBlur />
      </EffectComposer>
    </>
  )
}
