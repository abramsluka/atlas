'use client'

import { useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ─── Backdrop FX (tuned in docs/atlas-backdrop-lab.html) ────────────────────────
// Meteors (thin glowing streaks that shoot across + fade), twinkling/popping
// stars, faint purple nebula clouds, pulsing white beacon stars, drifting dust,
// and a base star field. No bloom — glow faked via additive sprites.

const METEOR_RATE = 0.4
const METEOR_SIZE = 0.8
const TWINKLE = 0.6
const NEBULA = 0.8
const DUST = 0.25

const rand = (a: number, b: number) => a + Math.random() * (b - a)
function randDir() {
  const t = Math.random() * 6.283, p = Math.acos(2 * Math.random() - 1)
  return new THREE.Vector3(Math.sin(p) * Math.cos(t), Math.sin(p) * Math.sin(t), Math.cos(p))
}

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(180,235,255,0.55)'); g.addColorStop(1, 'rgba(127,223,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c)
}
function streakTex() {
  const c = document.createElement('canvas'); c.width = 160; c.height = 32; const x = c.getContext('2d')!
  const g = x.createLinearGradient(0, 0, 160, 0)
  g.addColorStop(0, 'rgba(127,223,255,0)'); g.addColorStop(0.65, 'rgba(150,225,255,0.35)')
  g.addColorStop(0.93, 'rgba(220,245,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,1)')
  x.fillStyle = g; x.fillRect(0, 0, 160, 32)
  const h = x.createRadialGradient(150, 16, 0, 150, 16, 16); h.addColorStop(0, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = h; x.fillRect(120, 0, 40, 32)
  const v = x.createLinearGradient(0, 0, 0, 32); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.5, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)')
  x.globalCompositeOperation = 'destination-in'; x.fillStyle = v; x.fillRect(0, 0, 160, 32)
  return new THREE.CanvasTexture(c)
}
function cloudTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!
  for (let i = 0; i < 60; i++) {
    const px = rand(40, 216), py = rand(40, 216), r = rand(30, 90)
    const g = x.createRadialGradient(px, py, 0, px, py, r)
    g.addColorStop(0, `rgba(255,255,255,${rand(0.02, 0.06)})`); g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g; x.fillRect(0, 0, 256, 256)
  }
  return new THREE.CanvasTexture(c)
}

interface Meteor { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vel: THREE.Vector3; life: number; max: number; delay: number; len: number; active: boolean }

export default function StarField() {
  const built = useMemo(() => {
    const SOFT = softTex(), STREAK = streakTex(), CLOUD = cloudTex()
    const root = new THREE.Group()

    // base stars
    const bn = 1100, bp = new Float32Array(bn * 3)
    for (let i = 0; i < bn; i++) { const d = randDir().multiplyScalar(rand(40, 120)); bp[i*3]=d.x; bp[i*3+1]=d.y; bp[i*3+2]=d.z }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bp, 3))
    root.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: 0x9fc0e0, size: 0.18, transparent: true, opacity: 0.7, sizeAttenuation: true })))

    // twinkling / popping stars
    const tn = 700
    const tp = new Float32Array(tn * 3), ph = new Float32Array(tn), sz = new Float32Array(tn), sp = new Float32Array(tn)
    for (let i = 0; i < tn; i++) { const d = randDir().multiplyScalar(rand(30, 90)); tp[i*3]=d.x; tp[i*3+1]=d.y; tp[i*3+2]=d.z
      ph[i] = Math.random() * 6.283; sz[i] = rand(0.6, 2.4); sp[i] = rand(0.5, 2.5) }
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(tp, 3))
    tg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1))
    tg.setAttribute('aSize', new THREE.BufferAttribute(sz, 1))
    tg.setAttribute('aSpeed', new THREE.BufferAttribute(sp, 1))
    const twinkleMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAmt: { value: TWINKLE }, uMap: { value: SOFT } },
      vertexShader: `attribute float aPhase; attribute float aSize; attribute float aSpeed;
        uniform float uTime; uniform float uAmt; varying float vA;
        void main(){ float tw = 0.5 + 0.5*sin(uTime*aSpeed + aPhase); float pop = pow(tw, 4.0);
          vA = mix(0.35, 1.0, mix(tw, pop, 0.5));
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * 8.0 * (0.5 + uAmt*vA) / -mv.z * 50.0;
          gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA;
        void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.8,0.93,1.0), t.a*vA); }`,
    })
    root.add(new THREE.Points(tg, twinkleMat))

    // meteors (thin glowing streaks)
    const meteors: Meteor[] = []
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: STREAK, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      mesh.visible = false
      root.add(mesh)
      meteors.push({ mesh, mat, vel: new THREE.Vector3(), life: 0, max: 1, delay: rand(0, 6), len: 8, active: false })
    }

    // faint purple nebula clouds (no central stars)
    const purples = [0x5a2a9a, 0x6a38b8, 0x4a2a8a, 0x7048c0]
    const nebulaGrp = new THREE.Group()
    const nebulaClouds: { cmat: THREE.SpriteMaterial }[] = []
    for (let i = 0; i < 4; i++) {
      const cmat = new THREE.SpriteMaterial({ map: CLOUD, color: purples[i % purples.length], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
      const cloud = new THREE.Sprite(cmat); cloud.position.copy(randDir().multiplyScalar(rand(55, 95))); cloud.scale.setScalar(rand(55, 100)); nebulaGrp.add(cloud)
      nebulaClouds.push({ cmat })
    }
    root.add(nebulaGrp)

    // white beacon stars
    const beacons: { mat: THREE.SpriteMaterial; sprite: THREE.Sprite; phase: number; speed: number; base: number }[] = []
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.SpriteMaterial({ map: SOFT, color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
      const sprite = new THREE.Sprite(mat); sprite.position.copy(randDir().multiplyScalar(rand(35, 90))); const base = rand(1.2, 2.6); sprite.scale.setScalar(base)
      root.add(sprite); beacons.push({ mat, sprite, phase: Math.random() * 6.283, speed: rand(0.4, 1.1), base })
    }

    // drifting dust — soft round sprites, pushed out so none sit near the camera
    const dn = 500, dp = new Float32Array(dn * 3)
    for (let i = 0; i < dn; i++) { const d = randDir().multiplyScalar(rand(20, 58)); dp[i*3]=d.x; dp[i*3+1]=d.y; dp[i*3+2]=d.z }
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ map: SOFT, color: 0x9fc0e0, size: 0.45, transparent: true, opacity: 0.35 * DUST, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    root.add(dust)

    return { root, twinkleMat, meteors, nebulaGrp, nebulaClouds, beacons, dust }
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const dt = Math.min(delta, 0.05)
    const cam = state.camera

    built.twinkleMat.uniforms.uTime.value = t

    built.nebulaClouds.forEach((c) => { c.cmat.opacity = 0.6 * NEBULA })
    built.nebulaGrp.rotation.y = t * 0.004

    built.beacons.forEach((b) => {
      const k = 0.5 + 0.5 * Math.sin(t * b.speed + b.phase)
      b.mat.opacity = 0.25 + 0.6 * k
      b.sprite.scale.setScalar(b.base * (0.85 + 0.3 * k))
    })

    built.dust.rotation.y = t * 0.01

    // meteors: spawn on a timer, streak across, fade in→out, respawn
    for (const m of built.meteors) {
      if (!m.active) {
        m.delay -= dt * METEOR_RATE
        if (m.delay <= 0) {
          const origin = randDir().multiplyScalar(rand(45, 80))
          m.mesh.position.copy(origin)
          m.vel.copy(new THREE.Vector3().crossVectors(origin, randDir()).normalize()).multiplyScalar(rand(28, 46))
          m.len = rand(7, 16); m.max = rand(0.7, 1.4); m.life = 0; m.active = true; m.mesh.visible = true
        } else continue
      }
      m.life += dt
      const u = m.life / m.max
      if (u >= 1) { m.active = false; m.delay = rand(0.5, 5) / METEOR_RATE; m.mat.opacity = 0; m.mesh.visible = false; continue }
      m.mesh.position.addScaledVector(m.vel, dt)
      m.mat.opacity = Math.sin(Math.PI * u) * 0.95
      m.mesh.scale.set(m.len * METEOR_SIZE, 0.45 * METEOR_SIZE, 1) // thinner streak
      // orient the streak along velocity, billboarded toward the camera
      const toCam = new THREE.Vector3().subVectors(cam.position, m.mesh.position).normalize()
      const ax = m.vel.clone().normalize()
      const ay = new THREE.Vector3().crossVectors(toCam, ax)
      if (ay.lengthSq() < 1e-6) ay.set(0, 1, 0); else ay.normalize()
      const az = new THREE.Vector3().crossVectors(ax, ay).normalize()
      m.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, az))
    }
  })

  return <primitive object={built.root} />
}
