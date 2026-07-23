# Exercise Library — Spec & Implementation Plan

## Context

The gym page's add-exercise modal takes a free-text name and manual settings (rep range, step, bodyweight). Luka wants Atlas to feel like a real fitness app: a built-in exercise library with photos and instructions, an info (ⓘ) button next to each exercise, and a live-narrowing autocomplete on the name input that predicts the exercise as you type and prefills its settings (goal/rep range, step size, bodyweight flag) automatically. No per-use AI: the library is built once and reused forever. UI/UX must be high-end with polished animations.

**Decisions confirmed with Luka:**
- Content source: **free-exercise-db** (public domain, ~870 exercises, 2 demo photos each + step-by-step instructions + muscle tags), seeded once.
- Library size: **full ~870**, with an AI-assigned popularity score so common lifts rank first in search.
- **Personalized starting-weight hints in v1**: library stores a bodyweight-ratio per exercise; suggestion computed client-side from body weight + sex at pick time. Library stays global (first shared table in the app); personalization happens on-device.
- One-time Claude enrichment pass fills Atlas-specific fields (goal, step, popularity, aliases, start-weight ratio). Zero ongoing AI cost; the library replaces the "Let coach decide" Haiku call for linked exercises.

**Step 0 of implementation:** copy this spec into the repo as `EXERCISE_LIBRARY_SPEC.md` (Luka asked for the spec as a markdown file in the project).

---

## 1. Schema — `supabase/migrations/20260715000002_exercise_library.sql`

First global/shared table in Atlas (everything else is per-user):

```sql
create table if not exists exercise_library (
  id text primary key,                  -- dataset slug, e.g. 'Barbell_Bench_Press_-_Medium_Grip'; doubles as image folder
  name text not null,
  aliases text[] not null default '{}',           -- AI: 'OHP', 'Military Press'
  category text, equipment text, level text, mechanic text, force text,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions text[] not null default '{}',
  image_paths text[] not null default '{}',        -- bucket-relative '<slug>/0.jpg'
  -- AI-enriched Atlas fields
  bodyweight boolean not null default false,
  default_goal text not null default 'hypertrophy', -- strength | hypertrophy | endurance
  rep_min integer not null default 8,
  rep_max integer not null default 12,
  step numeric not null default 2.5,
  start_weight_ratio numeric,          -- beginner working weight ÷ body weight; NULL for stretches/cardio
  female_factor numeric,               -- multiplier when health_profile.sex = 'f'; NULL if no ratio
  popularity integer not null default 0,           -- 0-100 search ranking
  enriched_at timestamptz,             -- NULL = enrichment pending (resume checkpoint)
  created_at timestamptz default now()
);
alter table exercise_library enable row level security;
create policy "authenticated read exercise_library" on exercise_library
  for select to authenticated using (true);
-- writes go through service role (seed scripts) only — no write policies

alter table gym_exercises add column if not exists
  library_id text references exercise_library(id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exercise-images', 'exercise-images', true, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
```

- **Public bucket** (plain URLs, no signing): these are public-domain reference images, unlike the private progress-photos/food-photos buckets.
- No search index — search is client-side over a cached slim index.
- Run via house convention: `psql $DATABASE_URL -f supabase/migrations/20260715000002_exercise_library.sql` (DATABASE_URL in `.env.local`).
- Rep-range mapping is deterministic in the scripts (goal → 3–5 / 8–12 / 15–20) so the modal's Training-goal chips highlight correctly on prefill.

## 2. Seed pipeline — three scripts in `scripts/`, run in order

All copy the `scripts/cleanup-workouts.ts` template: manual `.env.local` parse, supabase-js with `SUPABASE_SERVICE_ROLE_KEY`, run via `npx tsx scripts/<name>.ts`.

**2a. `scripts/seed-exercise-library.ts`** (~180 lines)
1. Download the repo archive once (`github.com/yuhonas/free-exercise-db` main tarball → temp dir) — one download, not 1,740 raw GETs.
2. Parse `dist/exercises.json` (~870 entries), map camelCase → snake_case; `bodyweight = equipment === 'body only'` as a pre-enrichment heuristic; `image_paths` = dataset `images` verbatim.
3. Upsert rows in chunks of 100 with `onConflict: 'id'`, **only dataset-sourced columns** (re-runs never clobber AI enrichment).
4. Upload ~1,740 JPEGs to `exercise-images` (`upsert: true`, concurrency ~8, progress log every 100).

**2b. `scripts/enrich-exercise-library.ts`** (~200 lines) — separate from seed so a seed re-run never re-spends AI money.
- Loop: `select ... where enriched_at is null order by id limit 20` until empty. **Crash-safe: restart resumes; worst case re-spends one batch.**
- Per batch, one `anthropic.messages.create` copying the tool-use pattern from `src/app/api/gym/program/generate/route.ts`: `model: 'claude-opus-4-8'`, `tools: [{ name: 'emit_enrichment', input_schema }]`, `tool_choice` forced. Schema per item: `{ id, default_goal, bodyweight, step_lbs, popularity (0-100), aliases[], start_weight_ratio|null, female_factor|null }`.
- System prompt: strength-coach guidelines (barbell compounds step 5 lbs, cables/isolation 2.5; popularity = how commonly a lifter logs it; ratio examples bench ≈ 0.5×BW, squat ≈ 0.75, lateral raise ≈ 0.05; ratio NULL for stretches/cardio; female_factor ≈ 0.5–0.7 upper pressing, ~0.8 lower body).
- Script maps goal → rep_min/rep_max, validates returned ids, per-row update with `enriched_at = now()`. ~44 sequential calls, est. **$3–5 one-time**. Retry failed batch once, then log and continue.

**2c. `scripts/backfill-exercise-links.ts`** (~80 lines) — after enrichment (needs aliases).
- Normalize-match (lowercase, strip non-alphanumerics) every existing `gym_exercises.name` against library names **and aliases**; collisions resolved by higher popularity; set `library_id` on exact matches only; print matched/unmatched summary.

## 3. API — two routes, house pattern (SSR client for auth only, service client for data)

- **`src/app/api/gym/library/route.ts`** — GET slim index: `id, name, aliases, primary_muscles, bodyweight, default_goal, rep_min, rep_max, step, popularity, start_weight_ratio, female_factor`, ordered `popularity desc`. ~100–150 KB for 870 rows, fetched once per session.
- **`src/app/api/gym/library/[id]/route.ts`** — GET full detail; attaches `image_urls: string[]` built server-side via `storage.getPublicUrl()`. 404 if missing.
- No server search endpoint — filtering is client-side over the cached index (instant, zero per-keystroke latency). `proxy.ts` needs no bypass; routes are only called from the authenticated app.

## 4. Types + hooks

- **`src/features/gym/types.ts`**: `GymExercise` gains `library_id?: string | null`; new `ExerciseLibraryEntry` (slim index row) and `ExerciseLibraryDetail extends ExerciseLibraryEntry` (adds category/equipment/level/mechanic/force, secondary_muscles, instructions, image_urls).
- **`src/features/gym/queries.ts`**: `useExerciseLibrary()` → `['exercise-library']`, `staleTime: Infinity, gcTime: Infinity`; `useExerciseDetail(id | null)` → `['exercise-library', id]`, `enabled: !!id`.
- **`mutations.ts`: no changes** — create/update routes spread the body into insert/update, so `library_id` flows through once it's on the interface.

## 5. UI

### 5a. `src/app/gym/ExerciseAutocomplete.tsx` (new, ~180 lines)

Props: `{ value, onChange(name), onPick(entry), onInfo(id), entries }`.

- Renders the name input (same classes as current, keeps `autoFocus`) + a results list **in normal flow directly under the input** (`max-h-56 overflow-y-auto`). In-flow, not absolute — absolute dropdowns clip inside the modal's `overflow-y-auto max-h-[90vh]` sheet and fight the iOS keyboard.
- **Live narrowing (the core UX)**: filters on every keystroke, no search button. Opens at ≥2 chars. Score: name-startsWith (3) > alias-startsWith (2) > includes (1), tie-broken by popularity (index pre-sorted). Cap 8 rows. List visibly narrows toward the predicted exercise as you type — surviving rows glide up into place (see Motion).
- Row: name + `primary_muscles[0]` tag left; ⓘ button right (`onPointerDown` + `stopPropagation` → `onInfo(id)`). Row select on `onPointerDown` (fires before input blur).
- Always-present last row: dashed *`Use "<q>" as custom exercise`* → keeps free text, unlinked.
- Enter picks the top result; typing after a pick reopens the list.

### 5b. `src/app/gym/ExerciseInfoSheet.tsx` (new, ~220 lines)

Props: `{ id: string | null, onClose }`. Self-contained (`useExerciseDetail`), portals to `document.body`, `z-[70]` so it stacks above the exercise modal (`z-50`).

Content: name + close → **photo demo player** (see Motion) with START/END labels → muscle pills (primary green chips, secondary neutral, capitalized) → meta chips (equipment · category · level · mechanic · force, skipping nulls) → numbered instructions (`<ol>`, numbers dimmed). Pulse-skeleton loading state. Handles 1-image entries.

### 5c. `GymClient.tsx` wiring (~70 lines changed)

1. `ExModalState` gains `libraryId: string | null`; new `const [infoId, setInfoId] = useState<string | null>(null)`; `const { data: libraryIndex = [] } = useExerciseLibrary()`. (`useHealthProfile` already in GymClient at line 424 — no new plumbing.)
2. Replace name input (lines 2242–2250) with `<ExerciseAutocomplete>`; `onPick` prefills `{ name, libraryId, bodyweight, repMin, repMax, step }`. **Semantics: editing the name clears `libraryId` (different exercise); editing reps/step/bodyweight after a pick keeps the link (personal overrides are the per-user row's job).**
3. `openEditEx` copies `library_id`; `saveEx` includes `library_id` in create/update payloads.
4. Coach-step button wrapped in `{!exModal.libraryId && ...}` — library default replaces the Haiku call for linked exercises; customs keep it.
5. ⓘ on the exercise card hero (line ~1507, when `currentEx.library_id`) → `setInfoId(...)`.
6. **Start-weight hint** `useMemo`: `library_id && !bodyweight && exLogs.length === 0 && start_weight_ratio` → `bodyweight × ratio × (sex === 'f' ? female_factor ?? 1 : 1)`, rounded to `step`, floored at `step`. Rendered under the weight input as a tappable green hint (`Suggested start: ~95 lbs — tap to use` → sets the stepper). Auto-disappears after the first logged set.
7. Mount `<ExerciseInfoSheet id={infoId} onClose={() => setInfoId(null)} />` once at the bottom — shared by autocomplete rows and card icon.

## 6. Motion design (framer-motion v12, already installed and used in HomeClient/HealthClient/StreakStrip)

Shared spring constants in a small `src/app/gym/motion.ts` (e.g. `SPRING_SNAPPY = { type: 'spring', stiffness: 500, damping: 34 }`, `SPRING_SHEET = { stiffness: 380, damping: 38 }`). All effects respect `useReducedMotion()`.

**Autocomplete — "narrowing" feel:**
- List container: `AnimatePresence` + animated height so the dropdown grows/shrinks smoothly as matches change; rows use `layout` so when results narrow, survivors **glide upward** into place instead of snapping — the visual effect of the list converging on your exercise as you type.
- Row entrance: stagger 20 ms, fade + 6 px slide-up. Top-ranked row gets a faint green left-edge accent that springs in when it changes.
- Match highlighting: the typed substring rendered `text-white` against `text-white/60` rest, so the eye tracks why each result matched.
- Pick: dropdown collapses with a spring; then **prefill choreography** in the modal — the goal chip pops (scale 0.9→1 spring) and highlights, rep min/max tick to their new values, step field flashes a green sweep, bodyweight toggle animates if flipped. A small "⚡ from library" badge fades in under the name. Sells the "it filled everything for you" moment.

**Info sheet — the showpiece:**
- Spring-driven bottom sheet (`motion.div` with `drag="y"`, elastic top, velocity-based dismiss) + backdrop fade/blur; grab-handle bar.
- **Photo demo player**: the two dataset photos are literally the start and end of the movement — crossfade between them on a ~1.1 s loop (`AnimatePresence` opacity swap), turning two stills into a looping demo of the exercise. Tap to pause/scrub between frames. Paused when `useReducedMotion()`.
- Content cascade: photos → muscle pills → meta chips → instruction steps stagger in (~40 ms apart, fade + slide-up). Primary-muscle pills get a one-time soft green glow pulse on open.
- Instructions: numbered steps animate in sequence; numbers in dimmed green.

**Card + hint:**
- ⓘ icon on the card: gentle opacity breathe on first render after linking, then static.
- Start-weight hint: shimmer sweep across the green text; tapping it rolls the weight value into the stepper (animated number transition) and the hint collapses with a spring.

## 7. File-by-file change list & order

| # | File | Action | Size |
|---|---|---|---|
| 0 | `EXERCISE_LIBRARY_SPEC.md` (repo root) | new | copy of this spec |
| 1 | `supabase/migrations/20260715000002_exercise_library.sql` | new | ~55 |
| 2 | `scripts/seed-exercise-library.ts` | new | ~180 |
| 3 | `scripts/enrich-exercise-library.ts` | new | ~200 |
| 4 | `scripts/backfill-exercise-links.ts` | new | ~80 |
| 5 | `src/features/gym/types.ts` | edit | +35 |
| 6 | `src/app/api/gym/library/route.ts` | new | ~35 |
| 7 | `src/app/api/gym/library/[id]/route.ts` | new | ~40 |
| 8 | `src/features/gym/queries.ts` | edit | +25 |
| 9 | `src/app/gym/motion.ts` | new | ~15 |
| 10 | `src/app/gym/ExerciseAutocomplete.tsx` | new | ~180 |
| 11 | `src/app/gym/ExerciseInfoSheet.tsx` | new | ~220 |
| 12 | `src/app/gym/GymClient.tsx` | edit | ~70 changed |

Order: migration (psql) → seed → enrich → backfill → types → API → hooks → components → GymClient wiring. Data steps validate in isolation before any UI work. Load the `ui-ux-pro-max`/`ui-styling` skills before building the two components.

## 8. Verification

**Data:**
- Migration runs clean via psql; re-run is a no-op.
- `select count(*) from exercise_library` ≈ 870; a public image URL (`.../storage/v1/object/public/exercise-images/<slug>/0.jpg`) renders in a browser unauthenticated.
- After enrich: `count(*) where enriched_at is null` = 0; spot-check bench/squat for sane step/ratio/popularity/aliases. Kill mid-run once and restart to confirm resume.
- After backfill: existing exercises have `library_id`; unmatched listed.

**App (dev server, check /tmp/atlas-dev.log for TS errors; `npm run build` clean):**
- Type "ben" → dropdown narrows live to Bench Press variants, ranked sensibly, rows glide as it narrows; tap a row → name/bodyweight/rep chips/step all prefill with the choreography; correct goal chip highlighted.
- ⓘ on a dropdown row opens the sheet **above** the modal; photos crossfade-loop; pills/steps cascade in; drag-to-dismiss works.
- Save → DB row has `library_id`; card hero shows ⓘ; opens same sheet.
- New linked weighted exercise, zero logs → "Suggested start" hint under weight input; tap fills stepper; log a set → hint gone. Female-factor path checked by flipping `health_profile.sex`.
- Free text ("Weird Cable Thing") → custom row, `library_id` null, no ⓘ, coach-step button still present. Editing a linked name unlinks; re-picking relinks.
- Bodyweight pick (Pull-ups) → toggle on, step section hidden, no weight hint.
- Real feel tested on prod URL after deploy (mobile perf rule).

## 9. Risks / gotchas

- **GymClient.tsx is 2,593 lines** — all new UI in new files; GymClient gets wiring only.
- **Dropdown in a scrollable sheet** — in-flow list, never absolute positioning (clipping + iOS keyboard issues).
- **Dataset quirks**: `category` includes stretching/plyometrics/cardio — keep all, popularity buries them; muscle names contain spaces (`lower back`) — capitalize per word in UI; `start_weight_ratio` must be NULL for non-loaded movements (enforced in prompt + spot-checked).
- **AI spend safety**: `enriched_at` checkpoint, batch 20, seed upserts never touch AI columns.
- **Name-edit unlinks, numeric edits don't** — the one behavioral subtlety; document in a code comment.
- **Index payload** ~100–150 KB once per session; if it ever grows, trim `aliases` from the index before reaching for server search.

**Patterns to copy:** tool-use structured output from `src/app/api/gym/program/generate/route.ts`; script scaffold from `scripts/cleanup-workouts.ts`; storage upload from `src/app/api/gym/photos/route.ts`; sheet styling from GymClient's own modal (line 2228+).
