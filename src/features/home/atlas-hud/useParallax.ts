'use client'

import { useFrame } from '@react-three/fiber'
import type { RefObject } from 'react'
import type { Group } from 'three'

interface ParallaxOptions {
  /** Max tilt around X (vertical mouse), radians. */
  maxX?: number
  /** Max tilt around Y (horizontal mouse), radians. */
  maxY?: number
  /** Lerp factor toward the target each frame (lower = lazier). */
  damping?: number
}

/**
 * Gently rotates a group toward the cursor so the whole scene parallax-tilts
 * to follow the mouse. Reads r3f's normalized pointer (-1..1 over the canvas).
 * Spec §8: max tilt ~±14° (≈0.24 rad), damped.
 */
export function useParallax(
  ref: RefObject<Group | null>,
  { maxX = 0.18, maxY = 0.25, damping = 0.04 }: ParallaxOptions = {},
) {
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const targetY = state.pointer.x * maxY
    const targetX = state.pointer.y * maxX
    g.rotation.y += (targetY - g.rotation.y) * damping
    g.rotation.x += (targetX - g.rotation.x) * damping
  })
}
