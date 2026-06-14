'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function randDir() {
  const t = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1)
  return new THREE.Vector3(Math.sin(ph) * Math.cos(t), Math.sin(ph) * Math.sin(t), Math.cos(ph))
}

/**
 * Extra holographic detail around the Atlas globe, matching the reference HUD:
 * a plexus network (triangulated nodes + connecting lines), a vertical "barcode"
 * tick strip wrapping the limb, and geodesic arcs connecting surface points.
 * Additive/cyan so it reads as glowing data. The plexus slowly drifts.
 */
export default function GlobeFx({ R }: { R: number }) {
  const plexRef = useRef<THREE.Group>(null)

  const { plexusLines, plexusNodes, tickStrip, geoArcs } = useMemo(() => {
    // ── plexus: nodes in a shell, connect near neighbours (forms triangles) ──
    const N = 88
    const nodes: THREE.Vector3[] = []
    for (let i = 0; i < N; i++) nodes.push(randDir().multiplyScalar(R * (1.04 + Math.random() * 0.55)))
    const linePos: number[] = []
    const thresh = R * 0.52
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++)
        if (nodes[i].distanceTo(nodes[j]) < thresh)
          linePos.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3))
    const plexusLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x57a6e0, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending }))
    const npos = new Float32Array(N * 3)
    nodes.forEach((n, i) => { npos[i * 3] = n.x; npos[i * 3 + 1] = n.y; npos[i * 3 + 2] = n.z })
    const ng = new THREE.BufferGeometry()
    ng.setAttribute('position', new THREE.BufferAttribute(npos, 3))
    const plexusNodes = new THREE.Points(ng, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.03, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }))

    // ── vertical "barcode" tick strip wrapping part of the limb ──
    const axis = new THREE.Vector3(0.25, 1, 0.1).normalize()
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(1, 0, 0)).normalize()
    const v = new THREE.Vector3().crossVectors(axis, u).normalize()
    const tickPos: number[] = []
    const steps = 76
    for (let i = 0; i <= steps; i++) {
      const a = -0.7 + 1.5 * (i / steps)
      const dir = u.clone().multiplyScalar(Math.cos(a)).add(v.clone().multiplyScalar(Math.sin(a)))
      const len = R * (0.03 + 0.13 * Math.abs(Math.sin(i * 0.8)))
      const base = dir.clone().multiplyScalar(R * 1.03)
      const top = dir.clone().multiplyScalar(R * 1.03 + len)
      tickPos.push(base.x, base.y, base.z, top.x, top.y, top.z)
    }
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3))
    const tickStrip = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }))

    // ── geodesic connection arcs between surface points ──
    const geoArcs: THREE.Line[] = []
    for (let k = 0; k < 7; k++) {
      const p1 = randDir(), p2 = randDir()
      const pts: THREE.Vector3[] = []
      for (let i = 0; i <= 40; i++) {
        const t = i / 40
        const p = new THREE.Vector3().copy(p1).lerp(p2, t).normalize()
        pts.push(p.multiplyScalar(R * (1.0 + 0.18 * Math.sin(Math.PI * t))))
      }
      const ag = new THREE.BufferGeometry().setFromPoints(pts)
      geoArcs.push(new THREE.Line(ag, new THREE.LineBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending })))
    }

    return { plexusLines, plexusNodes, tickStrip, geoArcs }
  }, [R])

  useFrame((_, dt) => { if (plexRef.current) plexRef.current.rotation.y += dt * 0.012 })

  return (
    <>
      <group ref={plexRef}>
        <primitive object={plexusLines} />
        <primitive object={plexusNodes} />
      </group>
      <primitive object={tickStrip} />
      {geoArcs.map((a, i) => (
        <primitive key={i} object={a} />
      ))}
    </>
  )
}
