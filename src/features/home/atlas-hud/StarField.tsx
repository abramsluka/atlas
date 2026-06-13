'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * Long-exposure star-trail background: stars are short additive streaks tangent
 * to a tilted rotation axis, fading to black at the tail. The field slowly spins
 * around that axis, so they sweep like night-sky long-exposure trails (longer
 * near the equator, short near the pole). A few faint static points add depth.
 */
export default function StarField() {
  const spinRef = useRef<THREE.Group>(null)

  const { streaks, dots } = useMemo(() => {
    const R = 45
    const axis = new THREE.Vector3(0, 1, 0)

    // streaks
    const N = 420
    const pos: number[] = []
    const col: number[] = []
    for (let i = 0; i < N; i++) {
      const t = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1)
      const P = new THREE.Vector3(Math.sin(ph) * Math.cos(t), Math.sin(ph) * Math.sin(t), Math.cos(ph))
        .multiplyScalar(R * (0.8 + Math.random() * 0.45))
      const tangent = new THREE.Vector3().crossVectors(axis, P).normalize()
      const along = P.dot(axis)
      const radial = P.clone().sub(axis.clone().multiplyScalar(along)).length()
      const distNorm = Math.min(1, radial / R) // 0 at pole → 1 at equator
      const len = (0.3 + distNorm * 2.6) * (0.6 + Math.random())
      const b = P.clone().add(tangent.multiplyScalar(len))
      pos.push(P.x, P.y, P.z, b.x, b.y, b.z)
      const blue = Math.random() < 0.4
      const base = blue ? [0.4, 0.6, 1.0] : [0.75, 0.82, 1.0]
      const op = 0.18 + Math.random() * 0.4
      col.push(base[0] * op, base[1] * op, base[2] * op, 0, 0, 0) // bright head → black tail
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const streaks = new THREE.LineSegments(
      sg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, opacity: 0.9 }),
    )

    // faint static points for depth
    const M = 300, dp = new Float32Array(M * 3)
    for (let i = 0; i < M; i++) {
      const t = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1), r = R * (0.9 + Math.random() * 0.5)
      dp[i * 3] = r * Math.sin(ph) * Math.cos(t)
      dp[i * 3 + 1] = r * Math.sin(ph) * Math.sin(t)
      dp[i * 3 + 2] = r * Math.cos(ph)
    }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    const dots = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9fb8d8, size: 0.12, transparent: true, opacity: 0.5 }))

    return { streaks, dots }
  }, [])

  useFrame((_, dt) => {
    if (spinRef.current) spinRef.current.rotation.y += dt * 0.012 // slow trail sweep
  })

  return (
    <group rotation={[0.5, 0, 0]}>
      <group ref={spinRef}>
        <primitive object={streaks} />
      </group>
      <primitive object={dots} />
    </group>
  )
}
