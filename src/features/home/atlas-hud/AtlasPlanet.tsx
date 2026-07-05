'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import GlobeFx from './GlobeFx'

// ─── Central Atlas globe (ported from docs/atlas-globe-lab.html, settings locked) ──
// Real Earth continents (halftone dots from earth-water mask), multi-tone blue with
// elevation shading, directional day/night light, POI hex-nodes + sky dots, radial
// data-spikes, and comet-traced orbit arcs. No post-processing (EffectComposer
// black-flashes on this GPU) — glow comes from additive lines/rim. The globe is
// non-interactive; the HUD is exited via the top-right button, not by clicking it.

const ATLAS_R = 2.1
const SPIN = 0.05

const NOISE = /* glsl */ `
  float h31(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vn3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x),mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y),f.z); }
  float fbm3(vec3 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vn3(p); p*=2.0; a*=0.5; } return v; }
`

const GLOBE_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vWN; varying vec3 vV;
  void main(){ vUv=uv; vPos=position;
    vN=normalize(normalMatrix*normal); vWN=normalize(mat3(modelMatrix)*normal);
    vec4 mv=modelViewMatrix*vec4(position,1.0); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }
`

const GLOBE_FRAG =
  NOISE +
  /* glsl */ `
  varying vec2 vUv; varying vec3 vPos; varying vec3 vN; varying vec3 vWN; varying vec3 vV;
  uniform float uTime,uBright,uDotFreq,uDotSize,uOcean,uGrid,uScan,uFlipU,uInvert;
  uniform sampler2D uLand, uTopo; uniform vec3 uLightDir;
  void main(){
    vec2 luv = vec2(mix(vUv.x, 1.0 - vUv.x, uFlipU), vUv.y);
    float landRaw = texture2D(uLand, luv).r;
    float landVal = mix(1.0 - landRaw, landRaw, uInvert);   // water=white in source → land = 1-r
    float topo = texture2D(uTopo, luv).r;

    vec2 g = vUv*vec2(56.0,28.0);
    vec2 gd = abs(fract(g-0.5)-0.5);                                  // 0 at gridline → 0.5 between
    float line = (1.0 - smoothstep(0.0, 0.06, min(gd.x,gd.y))) * 0.5 * uGrid;  // derivative-free (iOS-safe)

    // continents from real Earth mask → halftone dots (uDotSize opens the spacing)
    float land = smoothstep(0.42,0.55, landVal);
    vec2 hp = vUv*vec2(uDotFreq, uDotFreq*0.5);
    float dd = length(fract(hp)-0.5);
    float dotCore = smoothstep(uDotSize, uDotSize-0.10, dd);          // crisp bright core
    float dotHalo = smoothstep(uDotSize+0.22, uDotSize-0.04, dd);     // soft glow around each dot
    float dotv = dotCore + dotHalo*0.55;
    float continents = dotv*land;
    float coast = smoothstep(0.34,0.5,landVal) * (1.0 - smoothstep(0.5,0.66,landVal));

    float fres = gl_FrontFacing ? pow(1.0-max(dot(vN,vV),0.0),3.0) : 0.0;  // no rim fill on back faces
    float scan = smoothstep(0.02,0.0,abs(fract(vUv.y-uTime*0.04)-0.5)) * uScan;

    // directional shading → continents get a lit (lighter) and shadowed (darker) side
    float diff = max(dot(normalize(vWN), normalize(uLightDir)), 0.0);
    float shade = 0.40 + 0.60 * diff;

    // electric-cyan holographic palette with cross-surface shade variation
    vec3 deepOcean = vec3(0.0,0.0,0.0);   // fully black — see straight through
    vec3 midOcean  = vec3(0.0,0.0,0.0);
    vec3 cyan      = vec3(0.13,0.55,1.0);       // vibrant electric blue
    vec3 brightCy  = vec3(0.45,0.90,1.0);       // bright cyan-white highlight

    float nLarge = fbm3(normalize(vPos)*1.6);   // large-scale shade drift across the globe
    float nFine  = fbm3(normalize(vPos)*7.0);   // dot-to-dot variation
    float dotVar = 0.60 + nFine*0.75;

    vec3 ocean  = mix(deepOcean, midOcean, nLarge*0.5);
    vec3 dotCol = mix(cyan, brightCy, clamp(topo*0.8 + nFine*0.6, 0.0, 1.0));

    vec3 col = ocean;
    col += cyan     * line * 0.10;
    col += dotCol   * continents * uBright * shade * dotVar;
    col += brightCy * coast * 0.45 * shade;
    col += cyan     * fres * 0.65;
    col += brightCy * scan * 0.34;

    float feat = clamp(line*0.12 + continents*0.92 + coast*0.4 + scan*0.4, 0.0, 1.0);
    float alpha = clamp(uOcean + feat*0.78 + fres*0.55, 0.0, 0.96);
    if(!gl_FrontFacing){ col*=0.42; alpha*=0.42; }  // back continents faintly visible through the front
    gl_FragColor = vec4(col, alpha);
  }
`

const ARC_VERT = /* glsl */ `
  attribute float aT; varying float vT;
  void main(){ vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`
const ARC_FRAG = /* glsl */ `
  precision mediump float; varying float vT; uniform vec3 uColor; uniform float uHead;
  void main(){
    float dashes = step(0.45, fract(vT * 70.0));
    float dist = fract(uHead - vT);
    float comet = smoothstep(0.16, 0.0, dist);
    float b = dashes * 0.22 + comet * 1.5;
    float a = dashes * 0.20 + comet * 0.95;
    gl_FragColor = vec4(uColor * b, a);
  }
`

const ATMO_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){ vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv; }
`
const ATMO_FRAG = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 5.5);  // high power → thin bright rim ring
    gl_FragColor = vec4(vec3(0.42, 0.84, 1.0) * f, f * 0.9); }
`

const ARC_BLUES = [0x5fc8ff, 0x8fdcff, 0x4aa8ff, 0xaee4ff, 0x6fd0ff]

// Soft radial-gradient sprite — fakes a glow halo (no post-processing bloom).
function makeGlowTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(210,242,255,1)')
  g.addColorStop(0.28, 'rgba(127,223,255,0.55)')
  g.addColorStop(1, 'rgba(127,223,255,0)')
  x.fillStyle = g
  x.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(c)
}

function makeHexTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const x = c.getContext('2d')!
  x.translate(32, 32)
  x.strokeStyle = '#aee4ff'
  x.lineWidth = 3
  x.beginPath()
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2
    const px = Math.cos(a) * 18, py = Math.sin(a) * 18
    i ? x.lineTo(px, py) : x.moveTo(px, py)
  }
  x.stroke()
  x.fillStyle = '#dff4ff'
  x.beginPath(); x.arc(0, 0, 4, 0, 7); x.fill()
  return new THREE.CanvasTexture(c)
}

function randDir() {
  const t = Math.random() * 6.283, ph = Math.acos(2 * Math.random() - 1)
  return new THREE.Vector3(Math.sin(ph) * Math.cos(t), Math.sin(ph) * Math.sin(t), Math.cos(ph))
}

/**
 * The central holographic Atlas globe (= Today / home). Non-interactive — it does
 * not respond to clicks; the HUD is exited via the top-right toggle button.
 */
export default function AtlasPlanet() {
  const [landTex, topoTex] = useTexture(['/textures/earth-water.png', '/textures/earth-topology.png'])
  const spinRef = useRef<THREE.Group>(null)

  const built = useMemo(() => {
    landTex.colorSpace = THREE.NoColorSpace
    topoTex.colorSpace = THREE.NoColorSpace
    landTex.wrapS = THREE.RepeatWrapping
    topoTex.wrapS = THREE.RepeatWrapping

    const globeMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.NormalBlending, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uBright: { value: 2.0 }, uDotFreq: { value: 340 }, uDotSize: { value: 0.35 },
        uOcean: { value: 0.0 }, uGrid: { value: 1 }, uScan: { value: 1 }, uFlipU: { value: 0 }, uInvert: { value: 0 },
        uLand: { value: landTex }, uTopo: { value: topoTex },
        uLightDir: { value: new THREE.Vector3(0.7, 0.35, 0.6).normalize() },
      },
      vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG,
    })

    // radial data-spikes (65) + glowing tips
    const sp: number[] = [], tp: number[] = []
    for (let i = 0; i < 65; i++) {
      const dir = randDir()
      const len = ATLAS_R * (0.15 + Math.random() * 0.45)
      const base = dir.clone().multiplyScalar(ATLAS_R * 1.01)
      const tip = dir.clone().multiplyScalar(ATLAS_R * 1.01 + len)
      sp.push(base.x, base.y, base.z, tip.x, tip.y, tip.z)
      tp.push(tip.x, tip.y, tip.z)
    }
    const spG = new THREE.BufferGeometry(); spG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    const spikes = new THREE.LineSegments(spG, new THREE.LineBasicMaterial({ color: 0x8fe0ff, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending }))
    const tpG = new THREE.BufferGeometry(); tpG.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3))
    // glowing tips (soft sprite halo)
    const tips = new THREE.Points(tpG, new THREE.PointsMaterial({ map: makeGlowTexture(), color: 0xcfeeff, size: 0.16, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }))

    // POI hex-nodes on the geography
    const hex = makeHexTexture()
    const pois: THREE.Sprite[] = []
    const poiData: { phase: number }[] = []
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.SpriteMaterial({ map: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })
      const s = new THREE.Sprite(mat)
      s.position.copy(randDir().multiplyScalar(ATLAS_R * 1.06))
      s.scale.setScalar(0.1)
      pois.push(s)
      poiData.push({ phase: Math.random() * 6.283 })
    }

    // faint sky dots in the space around the globe (inside Gym's 2.6 orbit)
    const N = 140, sd = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const r = ATLAS_R * (1.1 + Math.random() * 0.4)
      const d = randDir().multiplyScalar(r)
      sd[i * 3] = d.x; sd[i * 3 + 1] = d.y; sd[i * 3 + 2] = d.z
    }
    const sdG = new THREE.BufferGeometry(); sdG.setAttribute('position', new THREE.BufferAttribute(sd, 3))
    const skyDots = new THREE.Points(sdG, new THREE.PointsMaterial({ color: 0x7fd0ff, size: 0.025, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending }))

    // comet-traced orbit arcs (5)
    const arcs: { line: THREE.Line; mat: THREE.ShaderMaterial; speed: number; dir: number }[] = []
    for (let i = 0; i < 8; i++) {
      const rad = ATLAS_R * (1.08 + i * 0.06)
      const segs = 256, pos: number[] = [], aT: number[] = []
      for (let s = 0; s <= segs; s++) { const a = (s / segs) * 6.283; pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad); aT.push(s / segs) }
      const ag = new THREE.BufferGeometry()
      ag.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      ag.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1))
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uColor: { value: new THREE.Color(ARC_BLUES[i % ARC_BLUES.length]) }, uHead: { value: Math.random() } },
        vertexShader: ARC_VERT, fragmentShader: ARC_FRAG,
      })
      const line = new THREE.Line(ag, mat)
      line.rotation.set(Math.random() * 1.2 - 0.6, Math.random() * 6.283, Math.random() * 1.2 - 0.6)
      arcs.push({ line, mat, speed: 0.06 + Math.random() * 0.1, dir: Math.random() < 0.5 ? 1 : -1 })
    }

    // Large dotted ring well outside the globe — encompasses the orbital rings.
    const ringN = 340, ringR = ATLAS_R * 1.55, rp = new Float32Array(ringN * 3)
    for (let i = 0; i < ringN; i++) {
      const a = (i / ringN) * Math.PI * 2
      rp[i * 3] = Math.cos(a) * ringR; rp[i * 3 + 1] = 0; rp[i * 3 + 2] = Math.sin(a) * ringR
    }
    const ringG = new THREE.BufferGeometry()
    ringG.setAttribute('position', new THREE.BufferAttribute(rp, 3))
    const dottedRing = new THREE.Points(ringG, new THREE.PointsMaterial({
      color: 0x7fdfff, size: 0.05, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending,
    }))

    // thin bright rim ring around the globe (the "outer ring")
    const atmoMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.FrontSide, depthWrite: false,
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
    })

    // subtle ATLAS title above the globe (desktop only — gated in render)
    const lc = document.createElement('canvas'); lc.width = 256; lc.height = 64
    const lx = lc.getContext('2d')!
    lx.font = '800 30px ui-monospace, Menlo, monospace'; lx.textAlign = 'center'; lx.textBaseline = 'middle'
    lx.shadowColor = '#9fd8ff'; lx.shadowBlur = 14; lx.fillStyle = '#eaf4ff'; lx.fillText('ATLAS', 128, 34)
    const ltex = new THREE.CanvasTexture(lc); ltex.anisotropy = 4
    const atlasLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: ltex, transparent: true, depthWrite: false, opacity: 0.72 }))
    atlasLabel.scale.set(1.7, 0.42, 1)
    atlasLabel.position.set(0, ATLAS_R + 0.95, 0)

    return { globeMat, spikes, tips, pois, poiData, skyDots, arcs, dottedRing, atmoMat, atlasLabel }
  }, [landTex, topoTex])

  // ATLAS title shows on desktop only (mobile = clean globe)
  const isDesktop = useMemo(() => typeof window !== 'undefined' && window.innerWidth >= 640, [])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    built.globeMat.uniforms.uTime.value = t
    if (spinRef.current) spinRef.current.rotation.y = t * SPIN
    built.skyDots.rotation.y = -t * 0.02
    built.arcs.forEach((a) => { a.mat.uniforms.uHead.value = (a.mat.uniforms.uHead.value + a.dir * a.speed * 0.016 + 1) % 1 })
    built.pois.forEach((s, i) => {
      const k = 0.5 + 0.5 * Math.sin(t * 2 + built.poiData[i].phase)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.35 + 0.55 * k
      s.scale.setScalar(0.09 + 0.03 * k)
    })
  })

  return (
    <group>
      {/* globe + surface-attached detail spin together (Earth rotating) */}
      <group ref={spinRef}>
        {/* non-interactive: no onClick so the globe behaves like empty space */}
        <mesh>
          <sphereGeometry args={[ATLAS_R, 160, 160]} />
          <primitive object={built.globeMat} attach="material" />
        </mesh>
        <primitive object={built.spikes} />
        <primitive object={built.tips} />
        {built.pois.map((s, i) => (
          <primitive key={i} object={s} />
        ))}
      </group>

      {/* sky dots + arcs move independently of the globe spin */}
      <primitive object={built.skyDots} />
      {built.arcs.map((a, i) => (
        <primitive key={i} object={a.line} />
      ))}

      {/* dotted ring around the globe (no blue halo; dark space between) */}
      <group rotation={[0.5, 0, 0.18]}>
        <primitive object={built.dottedRing} />
      </group>

      {/* thin bright rim ring around the planet (the outer ring) */}
      <mesh>
        <sphereGeometry args={[ATLAS_R * 1.03, 64, 64]} />
        <primitive object={built.atmoMat} attach="material" />
      </mesh>

      {/* plexus web, tick strip, geodesic arcs — reference HUD detail */}
      <GlobeFx R={ATLAS_R} />

      {/* subtle ATLAS title above the globe — desktop only */}
      {isDesktop && <primitive object={built.atlasLabel} />}
    </group>
  )
}
