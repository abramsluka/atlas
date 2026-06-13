# Atlas HUD — Spec

> The home "map view" gets replaced with a Jarvis-style heads-up display: a single
> holographic hero planet called **Atlas** at the center, mouse-parallax + slow self-rotation,
> ringed by static HUD readouts wired to real Atlas data, with **four** modules as
> fixed-position satellite planets you can click to navigate. The center planet **is** Today/home.

Status: **spec / awaiting Phase-1 go-ahead.** Nothing in the real app is built yet.
A standalone look-and-feel mockup lives at `docs/atlas-hud-mockup.html`.

---

## 1. Decisions (locked)

| Decision | Choice |
|---|---|
| Concept | Jarvis HUD + hero Atlas planet; modules = fixed satellite planets |
| Atlas material | **Holographic** only — translucent cyan wireframe globe, glowing grid + dotted continents + scan rings (ref: the HUD globe pic). Obsidian rejected. |
| Render tech | **Photoreal 3D** — Three.js + react-three-fiber + drei + postprocessing |
| Labels | **In-scene billboards** (sprites that face camera, scale with distance, and get eclipsed behind planets). DOM labels rejected. |
| Bloom | **Two-tier & subtle** (see §9.1). Planets bloom ~0.20–0.21 (0.225–0.26 acceptable for the central Atlas halo); **label text blooms much LESS (~0.1)**. Center must NOT blow out to a white blob; grid + dotted continents must stay readable. |
| Self-rotation | Slow — **~0.015 max** on the Atlas Y axis. |
| Polish bar | This is the visual floor, not the ceiling — production Atlas must look meaningfully nicer than `atlas-hud-mockup.html`. |
| Center planet | **IS Today / home.** No separate "Today" satellite. Clicking the central Atlas planet routes to `/`. |
| Orbiting satellites | **Four:** Gym, Health, Journal, Mentor |
| Satellite colors | **green · blue · orange · purple** (no double-green). Center stays light-blue/white holographic. |
| Placement | Stays a **toggle** — this becomes the upgraded "map" view; bento dashboard stays default |
| Lead HUD readouts | Today's Call / briefing · Training & Fuel · Day progress |
| Deferred HUD readouts | Body & recovery (Oura/Whoop) — add once the Whoop data issue is resolved |

## 2. Why we're replacing the current CosmicMap

The existing `CosmicMap` in `HomeClient.tsx` has three structural problems, not just polish:

1. **Moving click targets.** Nodes orbit on CSS keyframes (`orbit0–4`). Clicking a sliding 44px
   target is why clicks miss. Fixed satellite positions fix this permanently.
2. **Redundant navigation.** The orbiting balls go to the same routes as the tab bar + bento grid.
3. **Shows zero data.** Luka wants "info about my day, my body, how I'm doing." The HUD layer is the
   only concept that serves that.

The new design keeps the distinct-planet idea but makes the planets **anchored** (clicks land),
**holographic/photoreal** (look awesome), and adds a **data HUD** (actually useful).

## 3. Visual target

- **Center — the Atlas planet (= Today / home):** a translucent **holographic** cyan/white globe.
  Glowing lat/long grid, halftone-dotted "continents," a bright atmospheric rim (fresnel), and a slow
  scan-ring sweep. Reads as a Jarvis hologram, not a solid ball. Slowly self-rotates on Y; the whole
  scene parallax-tilts toward the cursor (max ~±14°, damped). **Clickable → routes to `/`.**
- **Satellites:** 4 smaller planets at fixed anchor points around Atlas, colored green/blue/orange/
  purple (one per module). Slight idle bob/spin, **no fast orbiting**. Hover → scale up + bloom flare +
  billboard label brightens. Click → route. (Distinct planet *textures/characters* per §6.)
- **Labels:** in-scene **billboard sprites** — face the camera, scale with distance, parallax with the
  scene, and get eclipsed when a planet passes in front. This is the immersive 3D feel Luka wants.
- **Bloom/atmosphere glow** via postprocessing — kept **subtle** so the holographic detail survives.
- **HUD overlay (crisp DOM/SVG on top of the canvas):** corner brackets, scanlines, mono labels, a
  radar sweep, a day-progress arc, a training/fuel stat panel, and a Today's-Call status panel.
- Starfield background (stars rendered in-scene for true depth parallax).

## 4. Tech & dependencies

Add:
```
three
@react-three/fiber
@react-three/drei              # useTexture, Billboard, Stars, AdaptiveDpr
@react-three/postprocessing    # Bloom, Vignette
```

Rules:
- **Code-split the entire 3D module** with `next/dynamic(() => import(...), { ssr: false })` so Three.js
  never enters the main bundle. It only loads when the user enters map view.
- This is Next.js 16 — check `node_modules/next/dist/docs/` before any framework-level wiring (AGENTS.md).
- The `<Canvas>` lives only inside the `'use client'` dynamically-imported component.

## 5. File structure (new)

```
src/features/home/atlas-hud/
  AtlasHUD.tsx          # top-level; <Canvas> + HUD overlay; dynamic-imported by HomeClient
  Scene.tsx             # r3f scene: lights, planets, parallax rig, postprocessing
  AtlasPlanet.tsx       # central holographic planet (shader) + click → router.push('/')
  SatellitePlanet.tsx   # one module planet: textured mesh, billboard label, hover, onClick → router
  planets.ts            # config: id, label, href, color, texture, anchor position, size
  useParallax.ts        # pointer (+ deviceorientation) → damped target rotation
  hud/
    HudFrame.tsx        # corner brackets, scanlines, edge labels (decoration)
    DayArc.tsx          # day-progress arc (reuses computeRing logic)
    StatPanel.tsx       # training & fuel readout (from bento-stats)
    TodaysCallPanel.tsx # GREEN/YELLOW/RED verdict + headline + briefing line
    RadarSweep.tsx      # animated SVG radar sweep (decoration)

public/textures/planets/   # equirectangular planet texture maps (jpg) for the 4 satellites
```

`HomeClient.tsx` change: in the `mapView` branch, swap `<CosmicMap />` for the dynamic
`<AtlasHUD />`. Keep the toggle button, localStorage `atlas_view_mode`, and the Sunday modal as-is.
`CosmicMap` + its CSS keyframes get deleted once AtlasHUD lands.

## 6. Module → planet mapping (4 satellites + center)

Center is the hero, not a satellite.

| Slot | Route | Color | Planet character |
|---|---|---|---|
| **Atlas (center = Today/home)** | `/` | light-blue/white **holographic** | Translucent grid globe — the hero. Click → home. |
| Gym | `/gym` | **green** `#4ade80` | Verdant rocky world — green continents |
| Health | `/health` | **blue** `#3b82f6` | Ocean/ice world — deep blue water, white poles |
| Journal | `/journal` | **orange** `#fb923c` | Warm desert world — amber/sand bands |
| Mentor | `/mentor` | **purple** `#a855f7` | Banded gas giant — "the mind" |

Satellite textures: free equirectangular planet set (e.g. solarsystemscope.com — free for personal
use, attribute in a comment). Tint/grade toward each module color. Atlas itself is the **custom holo
shader**, not a stock texture. These HUD accent colors are intentionally their own palette and may
diverge from the bento-card colors.

## 7. HUD data sources (no new backend needed)

| Readout | Source | Notes |
|---|---|---|
| Day progress arc | `computeRing()` (already in HomeClient) | Extract to a shared util both views use |
| Training & Fuel | `GET /api/home/bento-stats` | Last workout, weekly count, today cal/protein |
| Today's Call | `POST /api/home/todays-call` | GREEN/YELLOW/RED + headline + bullets |
| Briefing line | `GET /api/home/briefing` | Cached briefing text (optional second line) |

Refactor: pull `computeRing` + palette helpers out of `HomeClient.tsx` into
`src/features/home/dayRing.ts` so both the list view's `DayRing` and the HUD `DayArc` share one source.

## 8. Interaction & motion

- **Parallax:** `useParallax` tracks pointer (+ `deviceorientation` on mobile), produces a target
  `{rotX, rotY}`; the scene rig lerps toward it each frame (damping ~0.05). Max tilt ±14°.
- **Self-rotation:** Atlas rotates slowly on Y (**~0.015 max**). Satellites idle-bob + slow spin.
- **Center click:** Atlas planet → `router.push('/')`.
- **Satellite hover:** scale 1→1.18, bloom emissive bump, billboard label brightens.
- **Satellite click:** quick scale pop → `router.push(href)`. (Fixed positions = clicks always land.)
- **Entrance:** planets fade/scale in staggered on mount; HUD frames draw on with a scanline wipe.

## 9. Performance & resilience

- Bloom kept low — both for the look (no white blob) and for cost. See §9.1 for the two-tier setup.
- `dpr={[1, 2]}` cap; drei `<AdaptiveDpr>` to drop res under load.
- Pause `useFrame` work when `document.hidden` and when the canvas is offscreen.
- No reduced-motion fallback (single-user app; Luka doesn't use the setting) — explicitly out of scope.
- Dynamic import means zero Three.js cost for users who never open map view.
- Mobile: lower bloom samples, fewer stars, smaller textures (2k → 1k on small screens).

### 9.1 Bloom — two tiers (planet vs. label text)

Luka wants the **planets** to bloom noticeably more than the **billboard label text**:

| Element | Target bloom feel |
|---|---|
| Central Atlas planet (halo) | ~**0.21**, up to **0.225–0.26** acceptable |
| Satellite planets / atmospheres | ~**0.20** (same tier as Atlas, can be a touch lower) |
| Billboard label text (GYM/HEALTH/…) | ~**0.1** — clearly calmer than the planets |

**RESOLVED — no post-processing.** `@react-three/postprocessing`'s `EffectComposer` caused a
full-screen black-flash flicker on Luka's GPU (reproduced repeatedly; survived antialias-off, Strict
Mode-off, and version checks — `postprocessing@6.39.1` does support `three@0.184`). Removing the
composer killed the flicker instantly. So **we render WITHOUT EffectComposer/Bloom.**

Instead, glow is per-element **additive fresnel "atmosphere" shells** (a slightly larger back-side
additive sphere around each planet, plus dim/no shell on labels). This is actually *better* than the
global bloom for the two-tier goal: each element's glow is fully independent (planets bright, labels
calm) with zero global pass — no selective-bloom gymnastics, no flicker. Tune per element.

## 10. Build phases

1. **Deps + scaffold.** Install libs. `AtlasHUD` with `<Canvas>`, lights, placeholder sphere, subtle
   bloom, parallax rig. Wire into the `mapView` toggle behind the dynamic import.
2. **Atlas planet.** Holographic shader: translucent grid + dotted continents + scan ring + rim, tuned
   so bloom doesn't blow it out. Center click → `/`. This is the centerpiece — spend time here.
3. **Satellite planets.** `planets.ts` config (4 planets, green/blue/orange/purple), textured meshes at
   fixed anchors, billboard labels, hover + click nav. Verify clicks always land.
4. **HUD overlay.** `HudFrame`, `DayArc`, `StatPanel`, `TodaysCallPanel`, `RadarSweep` — wired to the
   real endpoints. Refactor `computeRing` into the shared util.
5. **Polish + perf.** Entrance animation, dpr/visibility/offscreen guards, mobile texture tuning.
   Delete `CosmicMap` + dead keyframes.

## 11. Working agreement

**Ask follow-up questions any time during the build.** If something is ambiguous, a trade-off comes up,
or a look/behavior decision isn't covered here, pause and ask Luka rather than guessing — especially on
anything visual (materials, colors, motion, bloom) or anything that changes scope. Better a quick
question than building the wrong thing.

## 12. Open questions for build time (not blocking)

- Exact satellite textures + how hard to tint each toward its module color.
- Whether the day-progress arc wraps the planet (in-scene ring) or sits as a flat HUD arc in a corner.

---

## Out of scope

- Replacing the default bento dashboard (this stays a toggle).
- Body/recovery readout (deferred until Whoop/Oura data is reliable).
- Reduced-motion fallback.
- Any new backend endpoints — all data reuses existing routes.
