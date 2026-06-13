'use client'

import { useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import * as THREE from 'three'
import { KIND_TO_TYPE, type ModulePlanet } from './planets'

// ─── Billboard label (canvas sprite — self-contained, no font deps) ────────────
// A Sprite always faces the camera (true billboard) and, with depthTest on, gets
// eclipsed when a planet passes in front — the in-scene 3D feel Luka picked.

function makeLabelSprite(text: string, color: string) {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const ctx = c.getContext('2d')!
  ctx.font = '800 30px ui-monospace, Menlo, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = color
  ctx.shadowBlur = 12 // calm glow — labels stay calmer than planets (§9.1)
  ctx.fillStyle = color
  ctx.fillText(text.toUpperCase(), 128, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.anisotropy = 4
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const spr = new THREE.Sprite(mat)
  spr.scale.set(1.05, 0.266, 1) // 70% — labels trimmed 30%
  return spr
}

// ─── Procedural planet surface shader ──────────────────────────────────────────
// 3D value noise on object-space position (seamless — no UV poles), branched per
// `kind`, lit by a fixed world-space light for a day/night terminator. Surface
// rotates with the mesh; the lit side stays toward the light.

const NOISE3 = /* glsl */ `
  float hash31(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise3(vec3 x){
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                   mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                   mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm3(vec3 p){ float v = 0.0, a = 0.5;
    for(int i = 0; i < 5; i++){ v += a * vnoise3(p); p *= 2.0; a *= 0.5; } return v; }
`

const PLANET_VERT = /* glsl */ `
  varying vec3 vPos; varying vec3 vWN; varying vec3 vVN; varying vec3 vView;
  void main(){
    vPos = position;                              // object space → noise
    vWN  = normalize(mat3(modelMatrix) * normal); // world normal → lighting
    vVN  = normalize(normalMatrix * normal);      // view normal → fresnel
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const PLANET_FRAG =
  NOISE3 +
  /* glsl */ `
  uniform vec3 uColor; uniform float uType; uniform float uTime; uniform vec3 uLightDir;
  varying vec3 vPos; varying vec3 vWN; varying vec3 vVN; varying vec3 vView;

  void main(){
    vec3 p = normalize(vPos);
    float lat = p.y;
    vec3 surf = vec3(0.0);

    if (uType < 0.5) {
      // rocky — green continents over dark crust
      float n = fbm3(p * 2.6);
      float land = smoothstep(0.46, 0.60, n);
      surf = mix(vec3(0.04, 0.10, 0.07), uColor, land);
      surf = mix(surf, uColor * 1.35, smoothstep(0.64, 0.78, n));
    } else if (uType < 1.5) {
      // ocean — deep-blue water, lighter landmasses, white ice caps
      float n = fbm3(p * 2.3);
      float land = smoothstep(0.52, 0.60, n);
      surf = mix(vec3(0.02, 0.10, 0.30), mix(vec3(0.25, 0.55, 0.75), uColor, 0.5), land);
      surf = mix(surf, vec3(0.90, 0.95, 1.0), smoothstep(0.80, 0.92, abs(lat)));
    } else if (uType < 2.5) {
      // desert — banded amber / sand
      float bands = fbm3(p * 1.5 + vec3(0.0, lat * 3.0, 0.0));
      float n = fbm3(p * 4.5);
      surf = mix(uColor * 0.45, mix(uColor, vec3(1.0, 0.85, 0.6), 0.5), bands * 0.7 + n * 0.3);
    } else {
      // gas giant — horizontal bands with turbulence + bright streaks
      float turb = fbm3(p * 3.0 + vec3(uTime * 0.02, 0.0, 0.0)) * 0.5;
      float bands = sin(lat * 9.0 + turb * 4.0);
      surf = mix(uColor, uColor * 0.45 + vec3(0.05, 0.0, 0.08), smoothstep(-0.2, 0.2, bands));
      surf = mix(surf, vec3(0.92, 0.86, 1.0), smoothstep(0.82, 1.0, bands) * 0.35);
    }

    // day/night lighting + rim
    float diff = max(dot(normalize(vWN), normalize(uLightDir)), 0.0);
    vec3 lit = surf * (0.18 + diff * 1.05);
    float fres = pow(1.0 - max(dot(vVN, vView), 0.0), 3.0);
    lit += uColor * fres * 0.5;

    gl_FragColor = vec4(lit, 1.0);
  }
`

const GLOW_VERT = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){ vN = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv; }
`
const GLOW_FRAG = /* glsl */ `
  uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
  void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
    gl_FragColor = vec4(uColor * f, f * 0.8); }
`

export default function SatellitePlanet({
  planet,
  index,
  onNavigate,
}: {
  planet: ModulePlanet
  index: number
  onNavigate: (href: string) => void
}) {
  const orbitRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const planetMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(planet.color) },
          uType: { value: KIND_TO_TYPE[planet.kind] },
          uTime: { value: 0 },
          uLightDir: { value: new THREE.Vector3(1, 0.6, 0.8).normalize() },
        },
        vertexShader: PLANET_VERT,
        fragmentShader: PLANET_FRAG,
      }),
    [planet.color, planet.kind],
  )

  const glowMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uColor: { value: new THREE.Color(planet.color) } },
        vertexShader: GLOW_VERT,
        fragmentShader: GLOW_FRAG,
      }),
    [planet.color],
  )

  const label = useMemo(() => makeLabelSprite(planet.label, planet.color), [planet.label, planet.color])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // revolve around Atlas on this planet's own orbit
    if (orbitRef.current) orbitRef.current.rotation.y = t * planet.speed + planet.phase
    planetMat.uniforms.uTime.value = t
    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.15 + index // own-axis spin, offset per planet
      const want = hovered ? 1.18 : 1.0
      const k = meshRef.current.scale.x + (want - meshRef.current.scale.x) * 0.15
      meshRef.current.scale.setScalar(k)
    }
  })

  function handleClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation()
    onNavigate(planet.href)
  }

  return (
    // orbitRef revolves around Atlas; inner group offsets the planet to its radius
    <group ref={orbitRef}>
      <group position={[planet.radius, 0, 0]}>
        {/* planet body — the click target */}
        <mesh
          ref={meshRef}
          onClick={handleClick}
          onPointerOver={() => {
            setHovered(true)
            document.body.style.cursor = 'pointer'
          }}
          onPointerOut={() => {
            setHovered(false)
            document.body.style.cursor = 'default'
          }}
        >
          <sphereGeometry args={[planet.size, 64, 64]} />
          <primitive object={planetMat} attach="material" />
        </mesh>

        {/* glow shell */}
        <mesh scale={1.14}>
          <sphereGeometry args={[planet.size, 32, 32]} />
          <primitive object={glowMat} attach="material" />
        </mesh>

        {/* billboard label */}
        <primitive object={label} position={[0, planet.size + 0.26, 0]} />
      </group>
    </group>
  )
}
