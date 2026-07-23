# Exercise History & Progression — Spec & Implementation Plan

## Context

The gym page can log sets and it shows a live "prescription" (INCREASE / HOLD / etc.) for the
selected exercise, but it has **no way to look back at one exercise over time**. Luka wants the
Whoop/Overload-style experience: tap an exercise, get a **full-screen history pop-up** with an
Apple-stocks-style timeframe chooser, a scrubbable weight-progression chart with hover tooltips,
a "last 30 days" delta, an all-time best, and a session-by-session table. On top of that: a
**"new best" celebration** the moment you out-lift your record, a **"beat your best" next-target
card**, and **Swap / History buttons** on every exercise so the picker + info sheet are one tap away.

This is one bundled add-on to the existing PO Coach section — a "pop-up ecosystem" around the
selected exercise. It intentionally reuses the machinery that already ships.

**Design language** (from the "Overload" reference Luka attached): near-black canvas, italic serif
display headers ("history", "Barbell bench"), a mint/green primary accent (`#4ade80`) for the line +
progress, an **amber/gold** accent (`#f59e0b`-ish) reserved for records/celebration, tiny uppercase
tracked-out labels, serif numerals in the stat tiles. Match `ExerciseInfoSheet.tsx` for the sheet
chrome and `WtChart` for the chart craft.

### Confirmed scope (parsed from Luka's to-dos)

| To-do (Todoist / video) | Feature in this spec |
|---|---|
| "go to a new page or popup to see the history of an exercise… Apple stock ticker timeframe chooser… scroll through points… hover over a point and the date pops up" | **§5 Exercise History Sheet** + **§6 Progression Chart** |
| "make it so gives the increase in the last 30 days" | **§4 stats** → `LAST 30 DAYS` tile |
| "when I lift more weight than ever before I get a star animation that says new best, then click anywhere to continue" | **§7 New-Best Burst** |
| "beat your best" card: *Your best is 85 kg × 5. Beat it next session: 87.5 kg, or 85 kg × 6* + the two toggles | **§8 Next-Target card** + **§9 Settings** |
| "swap … for each exercise … swap suggests exercises but I can also search" (traveling / away from home gym) | **§10 Swap Sheet** — today-only substitute + hero button (§11) |
| "info thing with pictures + numbered instructions" | **How-to tab** of the detail sheet (§5b) — the already-built `ExerciseInfoSheet` content, moved into a tab |

### What already exists — reuse, do not rebuild

Confirmed in the codebase (file:line):
- **Per-exercise logs hook** `useGymLogs(exerciseId)` → `['gym-logs', id]`, `GET /api/gym/logs?exercise_id=` — `src/features/gym/queries.ts:56`. **This is the only data source the pop-up needs. No new route.**
- **Session-day bucketing** `logDatePST(utcStr)` — `GymClient.tsx:53`. Group sets into sessions with this exact fn (LA calendar day) so history matches "Past Workouts".
- **Epley 1RM** `compute1RM(weight, reps) = weight * (1 + reps/30)` — `GymClient.tsx:116`.
- **Best-set memo** `bestSet` (max reps for bodyweight, else max e1RM) — `GymClient.tsx:785`. Closest thing to a PR today; the new PR logic generalizes it.
- **Chart craft** `WtChart` inline-SVG area chart w/ rolling avg — `GymClient.tsx:210`; `PoSparkline` last-15-set sparkline — `GymClient.tsx:168`. **No charting library is installed** and none should be added — hand-rolled `<path>` + `<linearGradient>` is the house convention (StreakStrip, HomeClient, HealthClient all do this).
- **Sheet chrome** portal + backdrop + `drag="y"` dismiss + `SPRING_SHEET` — `ExerciseInfoSheet.tsx:99-111`. Copy this shell.
- **Info content** `ExerciseInfoSheet` (photos crossfade demo + numbered instructions + muscles/meta) — `src/app/gym/ExerciseInfoSheet.tsx`. **Done.** Its body becomes the **How-to tab** of the new detail sheet (§5b), and its bottom-sheet shell is the model for that sheet. The Swap rows' ⓘ opens the detail sheet straight to How-to.
- **Autocomplete filter/scoring** `ExerciseAutocomplete.tsx` — reuse its library-filter logic for Swap search.
- **Log mutation** `useLogSet` — `src/features/gym/mutations.ts:104` (POSTs `{exercise_id, weight, reps}`, appends to `['gym-logs', id]` + `['gym-logs-all']`). The burst hooks its success.
- **Motion constants** `EASE_OUT`, `SPRING_SNAPPY`, `SPRING_SHEET`, `SPRING_POP` — `src/app/gym/motion.ts`.
- **Exercise rail + hero** `ScrollChip` (`GymClient.tsx:324`), exercise hero (`GymClient.tsx:1539-1597`, where the ⓘ button already lives), `currentExId` state (514) + `selectEx(id)` (814).

### Net-new (what this spec builds)

- A **pure derivation module** (`history.ts`): sets → sessions → chart series + stats + PR detection. No hook re-implements what GymClient already computes ad hoc; this centralizes it.
- Components: **ExerciseDetailSheet** (one pop-up, tabbed **History** + **How-to**), **ProgressionChart**, **NewBestBurst**, **SwapSheet** — plus refactoring the existing `ExerciseInfoSheet` body into the How-to tab.
- One small migration: two `gym_config` toggles (celebration / next-target) + two `gym_logs` columns for today-only swap metadata.
- GymClient wiring: Swap/History buttons on the hero, mount the three overlays, fire the burst on PR.

**Step 0:** this file (`specs/gym/EXERCISE_HISTORY_SPEC.md`) is the spec, kept in the new `specs/` tree.

---

## 1. Architecture at a glance

```
GymClient (existing)
 ├─ exercise hero (1539) ── tap name/card OR [◔ detail] → detail sheet (History tab);  [⇄ swap] button
 ├─ useLogSet success ───── detectNewBest() → <NewBestBurst/>   ← gated by config.celebrate_pr
 └─ mounts overlays once at bottom:
      <ExerciseDetailSheet exerciseId={detailId} initialTab="history"/>  ← new — tabs: History | How-to
      <SwapSheet open={swapOpen} exercise={currentEx}/>                   ← new — today-only substitute
      <NewBestBurst best={burst}/>                                        ← new
   ExerciseInfoSheet is absorbed as the How-to tab body — no longer a standalone sheet/entry point.

src/features/gym/history.ts   (new, pure)
   groupSessions(logs, exercise) → ExerciseSession[]
   buildSeries(sessions, timeframe) → ChartPoint[]
   exerciseStats(sessions) → { sessionCount, last30Delta, best, allTimeDelta }
   detectNewBest(priorLogs, newSet, exercise) → NewBest | null
   nextTarget(best, exercise) → { weightTarget, repTarget }
```

Data flow: **one `useGymLogs(exerciseId)` fetch → `history.ts` derives everything client-side.** No server aggregation, no new endpoint.

---

## 2. Data model — session grouping & metrics (`src/features/gym/history.ts`, new, ~160 lines)

All pure, unit-testable, no React. Sets come from `GymLog[]` (`{ weight, reps, logged_at }`).

### 2a. Group sets → sessions

```ts
export interface ExerciseSession {
  dateKey: string        // LA day, from logDatePST(logged_at)  — reuse the SAME fn as GymClient
  date: Date             // parsed for the chart x-axis
  sets: GymLog[]         // all sets that day, chrono order
  topWeight: number      // max weight in the session (the "working weight" plotted)
  repsAtTop: number      // max reps achieved at topWeight (for "85 × 5")
  setCount: number
  totalReps: number      // Σ reps  (the "20 REPS" figure)
  e1rm: number           // max compute1RM across the session's sets
  deltaWeight: number | null  // topWeight − previous session's topWeight; null for the first
}
```

- **Filter swapped sets** (`performed_exercise != null`) out of the series, best, and deltas — they're a different movement done on a travel day (§10). Keep them for the table (greyed "swapped" rows) and for day volume.
- Group by `logDatePST(log.logged_at)` (import/duplicate the fn — see Gotchas on the shared-helper split).
- Order sessions **ascending** by dateKey for the chart; the table renders reversed.
- `deltaWeight` drives the table's PROGRESS column (`+2.5`, `first`, or a negative "off the line").

### 2b. Bodyweight exercises

When `exercise.bodyweight`, the "weight" axis is meaningless — plot **reps** instead:
- `topWeight` → treat `topReps = max reps`; the chart Y = `topReps`, tooltip shows "× N reps", PR is a rep PR, next target `reps + 1`. All downstream code branches on `exercise.bodyweight` exactly like `getRx` (GymClient:133) and `bestSet` (GymClient:785) already do.

### 2c. Stats (`exerciseStats`)

```ts
export interface ExerciseStats {
  sessionCount: number          // count within the ACTIVE timeframe (ALL = every session)
  last30Delta: number | null    // fixed 30-day window, ignores timeframe
  best: BestRecord              // all-time, ignores timeframe
  allTimeDelta: number          // latest topWeight − first topWeight  ("+10 kg · all time")
}
export interface BestRecord {
  weight: number    // heaviest weight ever lifted (bodyweight: max reps)
  reps: number      // max reps achieved at that heaviest weight
  e1rm: number
  dateKey: string
}
```

- **`last30Delta`** (this is the "increase in the last 30 days" to-do): `latestTopWeight − topWeightAsOf(today − 30d)`, where `topWeightAsOf` = the top weight of the latest session **on or before** the cutoff; if there is no session before the window, fall back to the **first session inside** the window (so a brand-new exercise still shows its climb). `null` when only one session exists → render `—`.
- **`best`**: scan all sets. `weight = max(weight)`; among sets at that weight, `reps = max(reps)`. Bodyweight → `weight` field carries the max-rep count.
- Tiles are labeled exactly like the reference: `SESSIONS` · `LAST 30 DAYS` · `BEST`.

### 2d. PR detection (`detectNewBest`)

```ts
export interface NewBest {
  kind: 'weight' | 'reps' | 'e1rm'
  weight: number
  reps: number
  prevWeight: number
  prevReps: number
}
// prior = ALL logs for this exercise BEFORE the new set was inserted
export function detectNewBest(prior: GymLog[], set: {weight:number;reps:number}, ex: GymExercise): NewBest | null
```

Rules (weighted exercise):
1. `set.weight > max(prior.weight)` → **weight PR** (the headline "new best").
2. else `set.weight === max(prior.weight)` **and** `set.reps > maxRepsAtThatWeight(prior)` → **reps PR**.
3. (optional, off by default) `compute1RM(set) > max(prior e1rm)` → **e1rm PR**.

Bodyweight: `set.reps > max(prior.reps)` → reps PR. Empty `prior` → **not** a PR (first-ever set is a baseline, not a record — matches the table's "first").

### 2e. Next target (`nextTarget`)

From `best`: `{ weightTarget: best.weight + ex.step, repTarget: best.reps + 1 }`. Rendered as
*"Your best is **{best.weight}{units} × {best.reps}**. Beat it next session: **{weightTarget}{units}**, or **{best.weight} × {repTarget}**."* — exactly the reference card.

---

## 3. Schema — `supabase/migrations/20260724000001_gym_history_prefs.sql` (new, ~10 lines)

Two things: per-user toggles on the single-row `gym_config`, and today-only swap metadata on `gym_logs`. Still **no new table and no new route** — only these columns plus tiny edits to the existing `config` and `logs` routes.

```sql
-- celebration + next-target toggles
alter table gym_config add column if not exists celebrate_pr boolean not null default true;
alter table gym_config add column if not exists show_next_target boolean not null default true;

-- today-only swap: the movement actually performed for a set (NULL = the slot's own exercise)
alter table gym_logs add column if not exists performed_exercise text;
alter table gym_logs add column if not exists performed_library_id text;  -- substitute's library slug, if picked from the library
```

- Run via house convention: `psql "$DATABASE_URL" -f supabase/migrations/20260724000001_gym_history_prefs.sql` (DATABASE_URL in `.env.local`). Re-run is a no-op.
- `config/route.ts` spreads the row on GET / body on PUT, so both flags flow through once on the `GymConfig` type (just default them `?? true` on the GET mapper for legacy rows). `logs/route.ts` POST must additionally accept + insert `performed_exercise`/`performed_library_id`; GET already `select *`s them.
- **Progression math ignores any set with `performed_exercise is not null`** (§2, §10): swapped sets never enter the original exercise's chart, best, or deltas — they'd be incomparable numbers (dumbbell vs barbell). They still count toward the day's volume and show in the history table as a greyed "swapped" row.

No new tables. History, sessions, and PRs are **derived from `gym_logs`** at read time; storing them would just create a sync-drift bug.

---

## 4. Types + hooks

**`src/features/gym/types.ts`** — extend `GymConfig`:
```ts
celebrate_pr?: boolean       // default true
show_next_target?: boolean   // default true
```
Extend `GymLog`: `performed_exercise?: string | null; performed_library_id?: string | null`.

Add the `ExerciseSession`, `ExerciseStats`, `BestRecord`, `NewBest` interfaces (or export them from `history.ts` and re-export — keep one home; `history.ts` is fine).

**`src/features/gym/queries.ts`** — no new hook required; `useGymLogs(exerciseId)` (line 56) already exists. The sheet calls it with `enabled: !!exerciseId`. If we want the timeframe/stat math memoized, do it in the component with `useMemo` over `history.ts` fns, not in a query.

**`mutations.ts`** — no change; `useSaveGymConfig` already persists arbitrary config fields, so the two toggles save through it.

---

## 5. UI — `src/app/gym/ExerciseDetailSheet.tsx` (new, ~320 lines) — the exercise pop-up (replaces the standalone info sheet)

**This is the one pop-up** that opens when you tap an exercise. It has a **tab strip** — **History** (default) · **How-to** — inside a single bottom sheet. Tapping the exercise name/card or the detail button lands on History; the tab strip switches the body to How-to (the built photos + instructions). One entry point, two views — the pattern every serious lifting app (Strong / Hevy / Apple Fitness) uses. "Info" and "Tutorial" are the same thing, so there are **two tabs, not three**.

Props: `{ exerciseId: string | null; exercise: GymExercise | null; units: 'lbs'|'kg'; showNextTarget: boolean; initialTab?: 'history'|'howto'; onLogSession: (exId: string) => void; onClose: () => void }`.

Portals to `document.body`, `z-[70]`, same shell as today's `ExerciseInfoSheet` (backdrop fade + `motion.div` bottom sheet, `drag="y"`, velocity dismiss, grab handle) + a segmented tab strip under the header. Switching tabs crossfades/slides the body (`AnimatePresence mode="wait"`) and springs the sheet height. History self-fetches via `useGymLogs(exerciseId)` and derives sessions/series/stats with `history.ts` in `useMemo`; How-to uses `useExerciseDetail(exercise.library_id)`.

### 5a. History tab — layout, top → bottom (mirrors the reference screenshot):

```
history                                            ×
Barbell bench                                        ← italic serif header
[ History • | How-to ]                               ← tab strip; History is the default tab

[ W ][ M ][ 3M ][ 6M ][ Y ][ ALL ]                  ← §6a TimeframeChooser (History tab only)

┌───────────────────────────────────────────────┐
│  <ProgressionChart/>  (§6)                      │
│   • area+line, crosshair, hover tooltip card    │
│   • "+10 kg · all time" caption centered below  │
│   • selected-session set pills:  [5][5][5][5]   │
│                                     20 REPS      │
└───────────────────────────────────────────────┘

★ Your best is 85 kg × 5. Beat it next session…    ← §8 next-target card (if showNextTarget)

┌ SESSIONS ┐ ┌ LAST 30 DAYS ┐ ┌ BEST ┐             ← §4 stat tiles, serif numerals
     6            +10 kg        85 kg

DATE     SETS   REPS   WEIGHT   PROGRESS            ← history table, newest first, scrolls
Jun 19    4      4     85 kg     +2.5
Jun 15    4      5     82.5 kg   +2.5
…                                                  first
                                    (+ log a session)  ← dashed button
```

- **Empty state** (0 sessions): serif "No history yet" + the dashed "+ log a session" CTA only.
- **Single session**: chart shows one point (dot, no line); deltas render `—`/`first`.
- **`+ log a session`**: `onClose()` then `onLogSession(exerciseId)` → GymClient calls `selectEx(id)` and scrolls the stepper into view / focuses it. Does **not** re-implement logging.
- The header word "history" is lowercase italic serif; exercise name is the big serif line (use `short_name` fallback to `name`).

Config default note: `config/route.ts` GET should default `celebrate_pr`/`show_next_target` to `true` when the columns are null on legacy rows (one-line `?? true` in the mapper) so the UI never sees `undefined`.

### 5b. How-to tab
The existing `ExerciseInfoSheet` body verbatim: the crossfade `DemoPlayer` (two dataset photos = start/end of the movement) + primary/secondary muscle pills + equipment/level meta chips + numbered instructions. **Refactor:** extract the inner content of `ExerciseInfoSheet`'s `SheetBody` into `<HowToTab detail={detail} />` and render it here; the old standalone `ExerciseInfoSheet` wrapper is removed (its shell logic moves to `ExerciseDetailSheet`). Loading = the existing pulse skeleton. If `exercise.library_id` is null (custom exercise) → How-to shows a tidy empty state ("No guide for a custom exercise") and the tab strip hides How-to entirely, opening straight to History.

---

## 6. UI — `src/app/gym/ProgressionChart.tsx` (new, ~220 lines)

Hand-rolled inline SVG, modeled on `WtChart` (`GymClient.tsx:210`). framer-motion for the draw-in and the crosshair. `useReducedMotion()` respected (no draw animation, static crosshair). **This is the showpiece — the "Apple stocks" interaction.**

### 6a. Timeframe chooser (sub-component or inline)
Segmented pill: `W · M · 3M · 6M · Y · ALL`. Active = filled green pill (`bg-[#4ade80]/15 text-[#4ade80] border`), inactive = ghost. Selecting one filters `sessions` to that window and re-fits the chart. `ALL` fits everything. Spring the active-pill background with `layoutId` (framer `layout`) so it slides between options. Default = `ALL` (or `3M` if ≥ ~12 sessions, so recent progress is legible — pick one; `ALL` is safest for v1).

### 6b. The chart
- **Series**: `buildSeries(sessions, timeframe)` → `{x: dateFraction, y: topWeight (or topReps), session}`.
- **Path**: smooth cubic-bezier `<path>` (Catmull-Rom→bezier, same technique as `WtChart`); area fill = vertical `<linearGradient>` green→transparent; stroke `#4ade80` ~2px. Y-domain padded ±one step; gridlines at 3 rounded weights (like the reference `70 / 80 / 90`).
- **Points**: a small circle at each session; the **hovered/scrubbed** point enlarges + gets a filled halo.
- **Draw-in**: `pathLength` 0→1 spring on open (`SPRING_SNAPPY`), points fade/pop in staggered after the line reaches them.
- **X labels**: first & last date of the visible window in the lower corners (`Jun 3` … `Jun 24`), tiny serif italic.

### 6c. Scrub + tooltip (the "hover over a point, date pops up" to-do)
- **Pointer/touch**: a full-height transparent overlay captures `onPointerMove` / `onPointerDown` + `onTouchMove`. Map clientX → nearest session index. This makes the points **"scrollable through"** on mobile (drag the finger across → crosshair tracks nearest point) — the primary target is the PWA on phone, so touch-drag is the main interaction, hover is the desktop bonus.
- **Crosshair**: a vertical line + the enlarged dot at the active index; animate its x with a fast spring so it glides between points instead of snapping.
- **Tooltip card**: floats above the active point, clamped inside the chart width. Content exactly like the reference: `Jun 15  82.5 kg  4 × 5 reps  ▲ +2.5` — date (serif italic) · weight (bold) · `setCount × repsAtTop reps` · delta chip (green ▲ / red ▼ / grey "first"). Below the chart, the **selected session's set pills** update to that session (`[5][5][5][5]` + `N REPS`).
- On pointer-leave (desktop) the active index snaps back to the latest session; on touch it stays where released (so you can read it).
- **"+10 kg · all time"** caption sits centered under the chart, always the all-time delta (not the scrubbed one).

### 6d. Bodyweight variant
Y-axis = reps, tooltip "× N reps" with no weight, caption "+N reps · all time". Everything else identical.

---

## 7. UI — `src/app/gym/NewBestBurst.tsx` (new, ~150 lines)

The "star animation → new best → click anywhere to continue" to-do. Full-screen amber celebration.

Props: `{ best: NewBest | null; units: string; exercise: GymExercise | null; onDismiss: () => void }`. Portal, `z-[90]` (above every sheet). Rendered only when `best` is set **and** `config.celebrate_pr`.

- **Backdrop**: black 70% + radial amber glow bloom from center, fades in ~200ms.
- **Star**: a big gold star (`#f59e0b`) springs in — scale `0.2→1.15→1` overshoot (`SPRING_POP`), slight rotation settle, soft glow pulse.
- **Particle burst**: ~14 SVG shards/sparks fired radially from the star on mount — each a `motion` element with random-per-index angle/distance/rotation (compute from index, **not** `Math.random()` — deterministic; workflow/SSR-safe), springing out then fading. Amber/white mix.
- **Copy**: serif "New best" headline; sub-line = the reference wording built from `nextTarget`:
  *"You beat your record. Next time, arm the bump: **{weight+step}{units}** or **{weight} × {reps+1}**."*
  Tiny dimmed "tap anywhere to continue".
- **Dismiss**: the whole overlay is one click/tap target → `onDismiss()`. Also auto-dismiss after ~6s as a fallback. Escape key on desktop.
- **Reduced motion**: no particles, star just fades in, copy static.
- Fires **once per qualifying set**. Trigger logic lives in GymClient's log-set success (§11), not here — this is a dumb presentational overlay driven by the `best` prop.

---

## 8. UI — Next-Target card (inline in the History Sheet, and optionally the hero)

A slim card under the chart (gated by `config.show_next_target`): amber ★ icon + the `nextTarget` sentence (§2e). Same card can optionally mount under the main exercise card on the gym page so the target is visible without opening history — but **v1 renders it in the sheet only** to avoid crowding the log screen; flag as a nice-to-have. Label in Settings: *"Next-target rule — the 'beat your best' card under the chart."*

---

## 9. Settings (in GymClient's existing Settings overlay, ~2604)

Two toggles, wired to `gym_config` via `useSaveGymConfig`:
- **"Celebrate a new best"** — *the full-screen burst when you beat your record.* → `celebrate_pr`.
- **"Next-target rule"** — *the "beat your best" card under the chart.* → `show_next_target`.

Reuse whatever toggle component the Settings overlay already uses for `upgrade_at_reps_auto`. Both default ON.

---

## 10. UI — `src/app/gym/SwapSheet.tsx` (new, ~200 lines)

**What swap is for** (per Luka): you're at a different gym and can't do the slot's movement as written — e.g. no barbell, only dumbbells. Swap lets you do a similar movement **for that one day only**; tomorrow the slot is back to normal. It is not a permanent change to your program.

Props: `{ open: boolean; exercise: GymExercise | null; entries: ExerciseLibraryEntry[]; onPick: (choice) => void; onInfo: (id) => void; onClose: () => void }`. Same bottom-sheet shell.

Contents:
- **Header**: "Swap **{exercise.name}** — today only".
- **Suggestions** (default): rank `useExerciseLibrary()` entries that **share a primary muscle** with the current exercise, **preferring a different `equipment`** (dumbbell / machine / cable when the original is a barbell), tie-broken by `popularity`, excluding the current one. Show ~8. Row: name/`short_name` + muscle tag + an equipment chip + right-side **ⓘ** → `onInfo(id)` (opens the detail sheet's How-to tab).
- **Search**: text input at top; reuse `ExerciseAutocomplete`'s filter+score over the same index for when the substitute isn't in the suggestions. Same row layout + ⓘ.
- **Custom**: dashed *Use "{query}" as today's swap* → free-text substitute (no library id).

### Swap semantics (recommended — today-only, non-destructive)
A swap does **not** create or rename any `GymExercise`. It sets a **per-day override** so, for today, the slot shows the substitute and the sets you log carry its name:
1. Picking a substitute records it in a client-held map keyed by `{today, exerciseId}` → `{ name, library_id }`. Persistence is implicit: every set logged while swapped is written with `performed_exercise` / `performed_library_id` (§3), so a reload re-derives "this slot is swapped today" from today's sets.
2. The log stepper stays on the **original** `exercise_id`; each `useLogSet` POST includes the `performed_*` fields. The hero shows "Barbell Bench → **Dumbbell Bench** · today" while swapped, with a small revert affordance.
3. **History stays clean**: progression math filters out `performed_exercise != null` sets (§2), so the barbell chart never gets a dumbbell point. In the History table that day renders as a greyed row: *swapped · Dumbbell Bench · 4×10*. Volume / "Today's Workout" still count it.
4. Auto-reverts: no swap record persists past the day. Tomorrow the slot is the original again.

**Why not create a real substitute exercise / rename the slot?** Renaming merges two movements' logs into one chart (corrupts progression). Creating a persistent "Dumbbell Bench" exercise clutters the daily rail forever after one travel day. The metadata approach is the least machinery that (a) is truly today-only and (b) keeps the original chart honest. **Trade-off:** no separate progression chart for the substitute — fine for a travel swap. If substitutes should later build their own history, that's the heavier "hidden variant exercise + per-day slot table" model — deferred.

---

## 11. GymClient wiring (`src/app/gym/GymClient.tsx`, ~60 lines changed)

1. **State**: `const [detail, setDetail] = useState<{id:string; tab:'history'|'howto'}|null>(null)`, `const [swapOpen, setSwapOpen] = useState(false)`, `const [burst, setBurst] = useState<NewBest|null>(null)`, `const [swaps, setSwaps] = useState<Record<string,{name:string;library_id?:string}>>({})` (today's active swaps by exerciseId). `libraryIndex` and `config` already in scope. The old `infoId` state is replaced by `detail`.
2. **Hero** (`GymClient.tsx:1539-1597`): make the exercise **name/card tappable** → `setDetail({id:currentExId, tab:'history'})`; repurpose the existing ⓘ button as the **detail** button (same target, History tab). Add a **⇄ Swap** button next to it → `setSwapOpen(true)`. Both act on `currentEx`. (Satisfies "swap and history buttons… whatever exercise is selected it goes to it.")
3. **PR burst**: in `handleLogSet` / `useLogSet` success (`GymClient.tsx:824` / `mutations.ts:104`), capture `exLogs` **before** the insert, then `const pr = detectNewBest(priorLogs, {weight, reps}, currentEx)`; if `pr && config.celebrate_pr !== false && !swaps[currentExId]` → `setBurst(pr)`. (No celebration on a swapped set — it's not a real record on this lift.) Guard so it fires once per set.
4. **Swap-aware logging**: when `swaps[currentExId]` is set, the hero shows "→ {swap.name} · today", and each `useLogSet` POST includes `performed_exercise: swap.name, performed_library_id: swap.library_id` (§3). A small "revert" affordance clears `swaps[currentExId]`.
5. **Mount overlays once** at the bottom (replacing the old `<ExerciseInfoSheet/>`):
   ```tsx
   <ExerciseDetailSheet exerciseId={detail?.id ?? null} exercise={exFor(detail?.id)} units={units}
       showNextTarget={config.show_next_target !== false} initialTab={detail?.tab ?? 'history'}
       onLogSession={(id)=>{ setDetail(null); selectEx(id); scrollStepperIntoView() }}
       onClose={()=>setDetail(null)} />
   <SwapSheet open={swapOpen} exercise={currentEx} entries={libraryIndex}
       onPick={(c)=>{ setSwaps(s=>({...s,[currentExId]:c})); setSwapOpen(false) }}
       onInfo={(id)=>setDetail({id, tab:'howto'})} onClose={()=>setSwapOpen(false)} />
   <NewBestBurst best={burst} units={units} exercise={currentEx} onDismiss={()=>setBurst(null)} />
   ```
6. Swap rows' ⓘ opens the same detail sheet on the **How-to** tab (`setDetail({id, tab:'howto'})`) — one sheet, no separate info overlay.

---

## 12. File-by-file change list & order

| # | File | Action | Size |
|---|---|---|---|
| 0 | `specs/gym/EXERCISE_HISTORY_SPEC.md` | new | this file |
| 1 | `supabase/migrations/20260724000001_gym_history_prefs.sql` | new | ~10 |
| 2 | `src/features/gym/history.ts` | new | ~160 (pure, testable) |
| 3 | `src/features/gym/types.ts` | edit | +8 (config flags; import history types) |
| 4 | `src/app/api/gym/config/route.ts` | edit | +2 (default the two flags on GET) |
| 4b | `src/app/api/gym/logs/route.ts` | edit | +4 (accept `performed_exercise`/`performed_library_id` on POST; already returned via `select *`) |
| 5 | `src/app/gym/ProgressionChart.tsx` | new | ~220 |
| 6 | `src/app/gym/ExerciseDetailSheet.tsx` | new | ~320 (History tab + tab strip; hosts How-to) |
| 6b | `src/app/gym/ExerciseInfoSheet.tsx` | refactor | body → `<HowToTab/>` used by the detail sheet; drop standalone wrapper |
| 7 | `src/app/gym/NewBestBurst.tsx` | new | ~150 |
| 8 | `src/app/gym/SwapSheet.tsx` | new | ~200 |
| 9 | `src/app/gym/GymClient.tsx` | edit | ~70 changed |

**Order**: migration (psql) → `history.ts` (+ a scratch test against real logs) → types/config/logs → chart → detail sheet (History tab + How-to refactor) → burst → swap → GymClient wiring. Build the chart and burst in isolation (temporary route or a story) before wiring, since they're the animation-heavy pieces. Load the `ui-ux-pro-max` / `ui-styling` skills before the chart, sheet, and burst.

---

## 13. Verification

**Derivation (`history.ts`, against Luka's real Bench logs):**
- `groupSessions` produces one session per training day; `topWeight`/`repsAtTop`/`totalReps` match "Today's / Past Workouts" for the same days.
- `last30Delta` equals hand-computed (latest top − top 30d ago); `—` when one session.
- `detectNewBest`: a heavier set flags weight PR; same weight + more reps flags rep PR; first-ever set flags nothing; a lighter set flags nothing.
- Bodyweight exercise (e.g. Pull-ups): everything runs on reps, no NaN weights.

**App (dev server, check `/tmp/atlas-dev.log`; `npm run build` clean):**
- Tap the exercise (or the detail button) → sheet rises on **History**; chart draws in; `ALL` fits all sessions; tap `M`/`3M` → window narrows, active pill slides. Switch to **How-to** → photos + numbered steps; switch back — sheet height springs, body crossfades.
- Drag finger across the chart → crosshair tracks nearest point, tooltip shows `date · weight · sets×reps · ▲delta`, set pills below update; release → stays.
- Stat tiles read `SESSIONS / LAST 30 DAYS / BEST`; "+X · all time" caption correct.
- Table lists sessions newest-first with correct PROGRESS (`+2.5` / `first` / negative).
- `+ log a session` closes sheet, selects Bench, focuses stepper.
- Log a set heavier than the all-time best → amber star burst, correct "arm the bump" numbers, tap anywhere dismisses; toggling **Celebrate a new best** off suppresses it. A **swapped** set never triggers the burst.
- **Next-target** card shows/hides with its toggle; wording matches best.
- **Swap** on Bench (traveling) → suggestions share the muscle group but prefer different equipment; search filters live; ⓘ opens How-to. Pick DB Bench → hero shows "Bench → Dumbbell Bench · today"; logged sets carry `performed_exercise`, appear in the table as greyed "swapped" rows, and do **not** move Bench's chart/best. Reload keeps today's swap; next day the slot is Bench again; revert affordance clears it early.
- Reduced-motion: chart static, burst no particles.
- Real feel verified on the **prod URL** on phone after deploy (mobile-perf rule), especially the touch scrub.

---

## 14. Risks / gotchas / decisions

- **`GymClient.tsx` is ~2,724 lines** — all new UI goes in new files; GymClient gets state + hero buttons + overlay mounts + the PR-check only.
- **Shared-helper duplication**: `logDatePST` / `compute1RM` live inside `GymClient.tsx` as module-local fns, not exports. `history.ts` needs them — either lift them into a shared `src/lib/gymCalc.ts` and import from both (cleanest), or duplicate the tiny fns in `history.ts`. **Prefer lifting** to avoid two definitions drifting; it's a mechanical extract. Note GymClient also re-declares `EASE_OUT` locally (line 7) instead of importing from `motion.ts` — don't copy that anti-pattern.
- **Dropdown/tooltip clipping in a scrollable sheet**: the sheet is `overflow-y-auto`; the chart tooltip must be positioned **within the chart's own bounds** (clamped), never an absolute popover that escapes the sheet — same lesson as the autocomplete list.
- **PR timing**: `detectNewBest` must run on the **pre-insert** log set. `useLogSet` optimistically appends to `['gym-logs', id]`, so capture `priorLogs` before calling the mutation, or diff against the server response — do not read the cache after the optimistic write.
- **Swap = today-only metadata, never rename/merge** (§10): swapped sets carry `performed_exercise` and are excluded from the original's progression math, so the chart stays honest and the slot auto-reverts next day. Never edit the `GymExercise` in place, never inject swapped weights into the line.
- **Units**: chart labels + targets use `config.units`; increments use `ex.step` (2.5 in kg data, 2.5/5 in lbs). Luka's data is **lbs**; the reference screenshots are kg — don't hardcode kg anywhere.
- **Determinism in the burst**: particle angles/offsets from the element index, never `Math.random()` / `Date.now()` (SSR + reproducibility).
- **`upgrade_at_reps` divergence (pre-existing)**: the config ceiling isn't read by `getRx` (which uses `ex.rep_max`); the next-target "×reps+1" here is derived from the actual best, so it sidesteps that bug — but if we ever surface "reps to next level," use `ex.rep_max`, not `config.upgrade_at_reps`. Out of scope, noted.
- **No stored PRs/sessions**: everything derives from `gym_logs` at read time. Deleting a set (`useDeleteLog`) automatically corrects history/best on the next render — a stored-PR table would need manual invalidation. Keep it derived.

**Patterns to copy**: sheet shell + drag-dismiss + cascade from `ExerciseInfoSheet.tsx`; inline-SVG chart from `WtChart` (`GymClient.tsx:210`); rail/filter + autocomplete scoring from `ExerciseAutocomplete.tsx`; spring constants from `motion.ts`; log mutation from `mutations.ts:104`.
