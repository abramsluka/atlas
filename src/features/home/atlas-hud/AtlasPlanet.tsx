'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ─── Holographic Atlas shader (ported + tuned from docs/atlas-hud-mockup.html) ──

const NOISE = /* glsl */ `
  vec2 hash2(vec2 p){ p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return fract(sin(p)*43758.5453); }
  float vnoise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    float a=hash2(i).x, b=hash2(i+vec2(1,0)).x, c=hash2(i+vec2(0,1)).x, d=hash2(i+vec2(1,1)).x;
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*vnoise(p); p*=2.0; a*=0.5; } return v; }
`

const HOLO_VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
  void main(){
    vUv = uv; vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const HOLO_FRAG =
  NOISE +
  /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; uniform float uTime;
  void main(){
    // fine lat/long grid
    vec2 g = vUv * vec2(48.0, 24.0);
    vec2 grid = abs(fract(g - 0.5) - 0.5) / fwidth(g);
    float line = (1.0 - clamp(min(grid.x, grid.y), 0.0, 1.0)) * 0.45;
    // halftone dotted continents
    float land = smoothstep(0.52, 0.70, fbm(vUv * 6.0 + 3.0));
    vec2 hp = vUv * vec2(170.0, 85.0);
    vec2 cell = fract(hp) - 0.5;
    float dotv = smoothstep(0.42, 0.28, length(cell));
    float continents = dotv * land;
    // fresnel rim
    float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
    // slow scan sweep in latitude
    float scan = smoothstep(0.025, 0.0, abs(fract(vUv.y - uTime * 0.05) - 0.5)) * 0.5;
    vec3 cyan = vec3(0.34, 0.85, 1.0);
    float intensity = line + continents * 1.0 + fres * 1.05 + scan;
    vec3 col = cyan * intensity;
    float alpha = clamp(line * 0.55 + continents * 0.85 + fres * 0.7 + scan * 0.55, 0.0, 0.8);
    if (!gl_FrontFacing) { col *= 0.45; alpha *= 0.45; }   // fainter back faces → see-through depth
    gl_FragColor = vec4(col, alpha);
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
  void main(){ float f = pow(1.0 - max(dot(vN, vV), 0.0), 3.5);
    gl_FragColor = vec4(vec3(0.3, 0.7, 1.0) * f, f * 0.85); }
`

const ATLAS_R = 1.4
const SPIN = 0.015 // spec: self-rotation ~0.015 max

/**
 * The central holographic Atlas planet (= Today / home).
 * Phase 1: renders the planet, atmosphere rim, and scan rings.
 * Phase 2 will add the click → router.push('/') interaction.
 */
export default function AtlasPlanet() {
  const sphereRef = useRef<THREE.Mesh>(null)
  const ringsRef = useRef<THREE.Group>(null)

  const holoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 } },
        vertexShader: HOLO_VERT,
        fragmentShader: HOLO_FRAG,
      }),
    [],
  )

  const atmoMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
      }),
    [],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    holoMat.uniforms.uTime.value = t
    if (sphereRef.current) sphereRef.current.rotation.y = t * SPIN
    if (ringsRef.current) {
      ringsRef.current.rotation.y = -t * 0.12
      ringsRef.current.rotation.z = Math.sin(t * 0.3) * 0.15
    }
  })

  return (
    <group>
      {/* holographic globe */}
      <mesh ref={sphereRef}>
        <sphereGeometry args={[ATLAS_R, 128, 128]} />
        <primitive object={holoMat} attach="material" />
      </mesh>

      {/* atmospheric rim */}
      <mesh>
        <sphereGeometry args={[ATLAS_R * 1.13, 64, 64]} />
        <primitive object={atmoMat} attach="material" />
      </mesh>

      {/* scan rings */}
      <group ref={ringsRef}>
        {[0, 1].map((i) => (
          <mesh key={i} rotation={[Math.PI / 2 + i * 0.5, 0, 0]}>
            <torusGeometry args={[ATLAS_R * 1.28, 0.005, 8, 160]} />
            <meshBasicMaterial color="#5fd8ff" transparent opacity={0.4} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
