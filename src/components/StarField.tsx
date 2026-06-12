'use client'
import { useEffect, useRef } from 'react'

interface Star {
  x: number; y: number; r: number; opacity: number;
  twinkleSpeed: number; twinkleOffset: number;
}

export default function StarField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = window.innerWidth
    const H = window.innerHeight
    canvas.width = W
    canvas.height = H

    // Seed 180 stars deterministically so they don't jump on re-render.
    // Iterate LCG state between each property so x and y are uncorrelated.
    // The old approach (seed + offset*1234) placed every star on the same diagonal.
    const stars: Star[] = Array.from({ length: 180 }, (_, i) => {
      let s = (i * 9301 + 49297) % 233280
      const next = () => { s = (s * 1664525 + 1013904223) % 233280; return s / 233280 }
      return {
        x: next() * W,
        y: next() * H,
        r: next() * 1.2 + 0.3,
        opacity: next() * 0.5 + 0.1,
        twinkleSpeed: next() * 0.008 + 0.003,
        twinkleOffset: next() * Math.PI * 2,
      }
    })

    let animId: number
    let t = 0
    function draw() {
      ctx!.clearRect(0, 0, W, H)
      t += 1
      for (const s of stars) {
        const alpha = s.opacity * (0.5 + 0.5 * Math.sin(t * s.twinkleSpeed + s.twinkleOffset))
        ctx!.beginPath()
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx!.fillStyle = `rgba(255,255,255,${alpha})`
        ctx!.fill()
      }
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(animId)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: 0,
      }}
    />
  )
}
