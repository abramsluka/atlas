// The four module satellite planets, each on its OWN orbit around the central
// Atlas planet: different radius, speed, and starting phase — like a real solar
// system (outer planets orbit slower). Tilt is shared (one orbital plane) and
// applied by the parent group in Scene. Clicks land even while orbiting because
// r3f raycasts the planet's live position.
//
// `kind` drives a procedural surface shader so each reads as a distinct world:
//   rocky  → Gym (green continents)
//   ocean  → Health (deep-blue water, white ice caps)
//   desert → Journal (banded amber/sand)
//   gas    → Mentor (banded purple gas giant)
//
// Colors are the HUD palette: green / blue / orange / purple (no double-green).
// Center (Atlas = Today/home) is the light-blue holographic globe, handled
// separately by AtlasPlanet.

export type PlanetKind = 'rocky' | 'ocean' | 'desert' | 'gas'

export interface ModulePlanet {
  id: string
  label: string
  href: string
  color: string
  kind: PlanetKind
  radius: number // orbital distance from Atlas
  speed: number // angular speed, rad/s (smaller = slower, for outer orbits)
  phase: number // starting angle so they don't line up
  size: number
}

// Equal angular speed + even 90° phases → planets stay locked a quarter-turn
// apart and never clump. (Outer planets still sweep faster across screen because
// their orbit circumference is larger.)
const ORBIT_SPEED = 0.06

// Radii sit outside the bigger Atlas globe (R=2.1) + its decorations (~3.15).
export const MODULE_PLANETS: ModulePlanet[] = [
  { id: 'gym',     label: 'Gym',     href: '/gym',     color: '#4ade80', kind: 'rocky',  radius: 3.5, speed: ORBIT_SPEED, phase: Math.PI * 0.0, size: 0.30 },
  { id: 'journal', label: 'Journal', href: '/journal', color: '#fb923c', kind: 'desert', radius: 4.2, speed: ORBIT_SPEED, phase: Math.PI * 0.5, size: 0.32 },
  { id: 'health',  label: 'Health',  href: '/health',  color: '#3b82f6', kind: 'ocean',  radius: 4.9, speed: ORBIT_SPEED, phase: Math.PI * 1.0, size: 0.34 },
  { id: 'mentor',  label: 'Mentor',  href: '/mentor',  color: '#a855f7', kind: 'gas',    radius: 5.6, speed: ORBIT_SPEED, phase: Math.PI * 1.5, size: 0.36 },
]

export const KIND_TO_TYPE: Record<PlanetKind, number> = { rocky: 0, ocean: 1, desert: 2, gas: 3 }
