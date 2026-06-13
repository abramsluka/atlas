'use client'

import { Suspense } from 'react'
import { OrbitControls } from '@react-three/drei'
import { DoubleSide } from 'three'
import AtlasPlanet from './AtlasPlanet'
import SatellitePlanet from './SatellitePlanet'
import StarField from './StarField'
import { MODULE_PLANETS } from './planets'

const ORBIT_TILT = 0.32 // ~18° shared orbital-plane tilt — the 3D solar-system look

/** One faint white-blue orbit line at a given radius (static; planets revolve along it). */
function OrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.008, radius + 0.008, 192]} />
      <meshBasicMaterial color="#aee4ff" transparent opacity={0.3} side={DoubleSide} />
    </mesh>
  )
}

/**
 * The r3f scene: lights, star-trail field, the Atlas globe, the per-planet orbit
 * rings + revolving satellites, and OrbitControls (drag the empty space to orbit
 * the camera around the system, like the design lab). Planet/center clicks still
 * fire because a click without drag is treated as a click, not a rotate.
 *
 * No post-processing (EffectComposer black-flashed on this GPU) — glow is done
 * with per-element additive shells. See spec §9.1.
 */
export default function Scene({
  onExit,
  onNavigate,
}: {
  onExit: () => void
  onNavigate: (href: string) => void
}) {
  return (
    <>
      {/* Lights drive the StandardMaterial satellites (the holo Atlas is unlit). */}
      <ambientLight color="#223344" intensity={0.6} />
      <directionalLight color="#9fd8ff" intensity={2.0} position={[4, 3, 5]} />
      <directionalLight color="#3a6cff" intensity={1.2} position={[-5, -2, -3]} />

      <StarField />

      {/* Suspense: AtlasPlanet's useTexture suspends while the Earth maps load */}
      <Suspense fallback={null}>
        <AtlasPlanet onSelect={onExit} />
      </Suspense>

      {/* Shared tilted orbital plane: one bright orbit line per planet radius,
          and each satellite revolves on its own orbit (radius/speed/phase). */}
      <group rotation={[ORBIT_TILT, 0, 0]}>
        {MODULE_PLANETS.map((p) => (
          <OrbitRing key={`${p.id}-ring`} radius={p.radius} />
        ))}
        {MODULE_PLANETS.map((p, i) => (
          <SatellitePlanet key={p.id} planet={p} index={i} onNavigate={onNavigate} />
        ))}
      </group>

      {/* Drag to orbit. Pan disabled; gentle zoom; clamped so you can't flip under. */}
      <OrbitControls
        makeDefault
        enablePan={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.5}
        minDistance={6}
        maxDistance={15}
        minPolarAngle={Math.PI * 0.16}
        maxPolarAngle={Math.PI * 0.84}
      />
    </>
  )
}
