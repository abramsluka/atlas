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
  // 7-octave fbm for fine surface detail
  float fbm7(vec3 p){ float v = 0.0, a = 0.5;
    for(int i = 0; i < 7; i++){ v += a * vnoise3(p); p = p * 2.03 + 1.3; a *= 0.52; } return v; }
  // ridged multifractal — sharp ridges (mountains, dunes)
  float ridged3(vec3 p){ float v = 0.0, a = 0.5;
    for(int i = 0; i < 6; i++){ float r = 1.0 - abs(2.0 * vnoise3(p) - 1.0); v += a * r * r; p = p * 2.05 + 0.7; a *= 0.5; } return v; }
`

const PLANET_VERT = /* glsl */ `
  varying vec3 vPos; varying vec3 vWN; varying vec3 vVN; varying vec3 vView; varying vec3 vWPos;
  void main(){
    vPos = position;                              // object space → noise
    vWN  = normalize(mat3(modelMatrix) * normal); // world normal → lighting
    vVN  = normalize(normalMatrix * normal);      // view normal → fresnel
    vWPos = (modelMatrix * vec4(position, 1.0)).xyz; // world pos → derivative bump
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const PLANET_FRAG =
  NOISE3 +
  /* glsl */ `
  uniform vec3 uColor; uniform float uType; uniform float uTime; uniform vec3 uLightDir;
  varying vec3 vPos; varying vec3 vWN; varying vec3 vVN; varying vec3 vView; varying vec3 vWPos;
  float ctr(float x){ return clamp((x - 0.5) * 1.1 + 0.5, 0.0, 1.0); }   // contrast 1.1

  void main(){
    vec3 p = normalize(vPos);
    float lat = p.y;
    float d = 0.8;   // detail
    vec3 surf = vec3(0.0);
    float height = 0.0;   // drives bump-mapped relief
    float gas = step(2.5, uType);

    if (uType < 0.5) {
      // rocky — continents, mountain ridges, dark basins
      float c = ctr(fbm7(p * 2.4 * d));
      float land = smoothstep(0.44, 0.58, c);
      float mtn = ridged3(p * 5.0 * d) * land;
      vec3 dirt   = vec3(0.20, 0.12, 0.06);  // brown rock/soil base (not black)
      vec3 forest = uColor * 0.48;           // green vegetation
      vec3 ridge  = uColor * 0.78;           // lighter green ridges
      surf = mix(dirt, forest, land);
      surf = mix(surf, ridge, mtn * 0.55);
      height = c * 0.5 + mtn * 0.7;
    } else if (uType < 1.5) {
      // ocean — deep water, landmasses, ice caps, fine wave detail
      float c = ctr(fbm7(p * 2.2 * d));
      float land = smoothstep(0.52, 0.60, c);
      float detail = fbm7(p * 6.5 * d);
      vec3 water = mix(vec3(0.01, 0.05, 0.20), vec3(0.04, 0.20, 0.46), detail);
      vec3 ground = mix(vec3(0.18, 0.46, 0.5), uColor, 0.45) * (0.7 + 0.5 * detail);
      surf = mix(water, ground, land);
      float ice = smoothstep(0.78, 0.9, abs(lat) + fbm7(p * 4.0) * 0.12);
      surf = mix(surf, vec3(0.9, 0.96, 1.0), ice);
      height = land * 0.5 + detail * 0.15;
    } else if (uType < 2.5) {
      // desert — dune bands with fine ridged ripples
      float bands = ctr(fbm7(p * 1.7 * d + vec3(0.0, lat * 4.0, 0.0)));
      float ripple = ridged3(p * 9.0 * d);
      surf = mix(uColor * 0.4, mix(uColor, vec3(1.0, 0.88, 0.62), 0.55), bands * 0.6 + ripple * 0.4);
      height = bands * 0.35 + ripple * 0.55;
    } else {
      // gas giant — domain-warped turbulent bands + a storm spot (smooth, no bump)
      vec3 warp = vec3(fbm7(p * 2.0 * d), fbm7(p * 2.0 * d + 5.2), fbm7(p * 2.0 * d + 9.1));
      float turb = fbm7(p * 3.0 * d + warp * 1.6 + vec3(uTime * 0.02, 0.0, 0.0));
      float bands = ctr(sin(lat * 11.0 + turb * 5.0) * 0.5 + 0.5);
      surf = mix(uColor * 0.4 + vec3(0.06, 0.0, 0.10), uColor, bands);
      float storm = smoothstep(0.74, 0.94, fbm7(p * 4.0 * d + warp));
      surf = mix(surf, vec3(0.95, 0.88, 1.0), storm * 0.4);
    }

    // (bump removed — derivative funcs fail to compile on iOS Safari; it was
    //  only 0.05 anyway, so the look is unchanged. height/gas now unused.)
    vec3 N = normalize(vWN);

    vec3 L = normalize(uLightDir);
    float diff = max(dot(N, L), 0.0);
    vec3 lit = surf * (0.15 + diff * 1.15);

    // specular sun-glint (water shiniest)
    float shin = (uType > 0.5 && uType < 1.5) ? 28.0 : 10.0;
    lit += vec3(0.75, 0.88, 1.0) * pow(diff, shin) * 0.6;

    // atmospheric rim
    float fres = pow(1.0 - max(dot(vVN, vView), 0.0), 3.0);
    lit += uColor * fres * 0.3;

    gl_FragColor = vec4(lit, 1.0);
  }
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
          onPointerOver={(e) => {
            setHovered(true)
            // set on the canvas itself so it overrides the wrapper's grab cursor
            ;(e.nativeEvent.target as HTMLElement).style.cursor = 'pointer'
          }}
          onPointerOut={(e) => {
            setHovered(false)
            ;(e.nativeEvent.target as HTMLElement).style.cursor = ''
          }}
        >
          <sphereGeometry args={[planet.size, 96, 96]} />
          <primitive object={planetMat} attach="material" />
        </mesh>

        {/* billboard label */}
        <primitive object={label} position={[0, planet.size + 0.26, 0]} />
      </group>
    </group>
  )
}
