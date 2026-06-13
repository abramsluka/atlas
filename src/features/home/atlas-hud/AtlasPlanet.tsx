'use client'

import { useMemo, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'

// ─── Central Atlas globe (ported from docs/atlas-globe-lab.html, settings locked) ──
// Real Earth continents (halftone dots from earth-water mask), multi-tone blue with
// elevation shading, directional day/night light, POI hex-nodes + sky dots, radial
// data-spikes, and comet-traced orbit arcs. No post-processing (EffectComposer
// black-flashes on this GPU) — glow comes from additive lines/rim. Clicking the
// globe exits the HUD back to the bento dashboard.

const ATLAS_R = 1.4
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
    vec2 gr = abs(fract(g-0.5)-0.5)/fwidth(g);
    float line = (1.0 - clamp(min(gr.x,gr.y),0.0,1.0)) * 0.5 * uGrid;

    // continents from real Earth mask → halftone dots (uDotSize opens the spacing)
    float land = smoothstep(0.42,0.55, landVal);
    vec2 hp = vUv*vec2(uDotFreq, uDotFreq*0.5);
    float dotv = smoothstep(uDotSize, uDotSize-0.14, length(fract(hp)-0.5));
    float continents = dotv*land;
    float coast = smoothstep(0.34,0.5,landVal) * (1.0 - smoothstep(0.5,0.66,landVal));

    float fres = pow(1.0-max(dot(vN,vV),0.0),3.0);
    float scan = smoothstep(0.02,0.0,abs(fract(vUv.y-uTime*0.04)-0.5)) * uScan;

    // directional shading → continents get a lit (lighter) and shadowed (darker) side
    float diff = max(dot(normalize(vWN), normalize(uLightDir)), 0.0);
    float shade = 0.40 + 0.60 * diff;

    // darker, deeper-blue palette (less near-white cyan)
    vec3 deepOcean = vec3(0.006,0.018,0.045);
    vec3 midBlue   = vec3(0.04,0.15,0.34);
    vec3 cyan      = vec3(0.20,0.54,0.85);
    vec3 brightBlue= vec3(0.42,0.72,1.0);

    float oceanN = fbm3(normalize(vPos)*2.2);
    vec3 ocean  = mix(deepOcean, midBlue*0.5, oceanN*0.6);
    vec3 dotCol = mix(cyan, brightBlue, clamp(topo*1.3 + oceanN*0.2, 0.0, 1.0));

    vec3 col = ocean;
    col += cyan      * line * 0.30;
    col += dotCol    * continents * uBright * shade;
    col += brightBlue* coast * 0.40 * shade;
    col += cyan      * fres * 0.60;
    col += brightBlue* scan * 0.32;

    float feat = clamp(line*0.35 + continents*0.78 + coast*0.4 + scan*0.4, 0.0, 1.0);
    float alpha = clamp(uOcean + feat*0.78 + fres*0.55, 0.0, 0.96);
    if(!gl_FrontFacing){ col*=0.40; alpha*=0.45; }
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
  void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 4.5);
    gl_FragColor = vec4(vec3(0.26, 0.56, 1.0) * f, f * 0.42); }
`

const ARC_BLUES = [0x5fc8ff, 0x8fdcff, 0x4aa8ff, 0xaee4ff, 0x6fd0ff]

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
 * The central holographic Atlas globe (= Today / home). Clicking it exits the HUD
 * back to the bento dashboard (same `/` route, toggled by state).
 */
export default function AtlasPlanet({ onSelect }: { onSelect: () => void }) {
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
        uTime: { value: 0 }, uBright: { value: 1.5 }, uDotFreq: { value: 270 }, uDotSize: { value: 0.37 },
        uOcean: { value: 0.14 }, uGrid: { value: 1 }, uScan: { value: 1 }, uFlipU: { value: 0 }, uInvert: { value: 0 },
        uLand: { value: landTex }, uTopo: { value: topoTex },
        uLightDir: { value: new THREE.Vector3(0.7, 0.35, 0.6).normalize() },
      },
      vertexShader: GLOBE_VERT, fragmentShader: GLOBE_FRAG,
    })

    // radial data-spikes (65) + glowing tips
    const sp: number[] = [], tp: number[] = []
    for (let i = 0; i < 65; i++) {
      const dir = randDir()
      const len = ATLAS_R * (0.1 + Math.random() * 0.3)
      const base = dir.clone().multiplyScalar(ATLAS_R * 1.01)
      const tip = dir.clone().multiplyScalar(ATLAS_R * 1.01 + len)
      sp.push(base.x, base.y, base.z, tip.x, tip.y, tip.z)
      tp.push(tip.x, tip.y, tip.z)
    }
    const spG = new THREE.BufferGeometry(); spG.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3))
    const spikes = new THREE.LineSegments(spG, new THREE.LineBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending }))
    const tpG = new THREE.BufferGeometry(); tpG.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3))
    const tips = new THREE.Points(tpG, new THREE.PointsMaterial({ color: 0x9fe8ff, size: 0.035, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }))

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
    for (let i = 0; i < 5; i++) {
      const rad = ATLAS_R * (1.1 + i * 0.08)
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

    const atmoMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false,
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG,
    })

    return { globeMat, spikes, tips, pois, poiData, skyDots, arcs, atmoMat }
  }, [landTex, topoTex])

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

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation()
    onSelect()
  }

  return (
    <group>
      {/* globe + surface-attached detail spin together (Earth rotating) */}
      <group ref={spinRef}>
        <mesh
          onClick={handleClick}
          onPointerOver={() => { document.body.style.cursor = 'pointer' }}
          onPointerOut={() => { document.body.style.cursor = 'default' }}
        >
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

      {/* atmospheric rim glow */}
      <mesh>
        <sphereGeometry args={[ATLAS_R * 1.12, 64, 64]} />
        <primitive object={built.atmoMat} attach="material" />
      </mesh>
    </group>
  )
}
