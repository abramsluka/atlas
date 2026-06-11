# Spec: Add Food, Quick Drink & Barcode Scan — Food Logging v2

> **For the implementing agent:** This is an executable spec. Read it fully, then implement in the
> phase order given. Every referenced file path is real. Follow the existing patterns named here —
> do not invent new architecture. When this spec and the codebase disagree on a detail (e.g. a
> column name), trust the codebase and keep moving.

## Goal

The FOOD section on the health page currently has one entry point: photo-based "Snap a meal."
Add three more, matching this button row design (primary pill + secondary pills):

```
[ 📷 Snap a meal ]  ( Add food )  ( Quick drink )  ( ▮▮ Scan )
```

1. **Add food** — type what you ate → AI estimates → if quantity is ambiguous, AI asks ONE
   follow-up question with tappable quick-pick amounts → save.
2. **Quick drink** — same flow tuned for drinks, with instant presets. Hydrating drinks also
   log volume to the water tracker.
3. **Scan** — live camera barcode scan → Open Food Facts lookup → serving picker (with optional
   "snap your portion" photo assist) → save.
4. **Frequents** — every text/drink/barcode item saved builds a personal library for one-tap re-logging.

## Existing Code Map (read these before writing)

| Path | What it is |
|---|---|
| `src/app/health/HealthClient.tsx` → `FoodSection` (~line 1945) | The food UI. All new UI goes here (or extracted into sibling components in the same file's style). |
| `src/app/api/health/food/route.ts` | GET day's logs + POST photo meal (gpt-4o-mini vision). The pattern to copy for new routes. |
| `src/features/food/types.ts`, `queries.ts`, `mutations.ts` | TanStack Query layer. Extend, don't bypass. |
| `src/app/api/health/water/route.ts` | Water logging (POST `{ date, amount_oz }` to `water_logs`). Quick Drink reuses this server-side. |
| `src/lib/openai.ts` → `getOpenAI()` | OpenAI client helper. Use `gpt-4o-mini` for all estimation. |
| `supabase/migrations/20260525000008_food_logs.sql` | Current `food_logs` schema. |

**API route auth pattern (mandatory, from CLAUDE.md):** `createClient()` only for `auth.getUser()`;
`createServiceClient()` for ALL db reads/writes. 401 JSON on no user.

**Reminder:** migrations are NOT auto-applied. End your work by telling Luka exactly which
migration file to run in the Supabase SQL editor.

## Phase 1 — Database

New migration `supabase/migrations/<today>000001_food_logging_v2.sql`:

```sql
-- Typed/barcode entries have no photo
alter table food_logs alter column storage_path drop not null;

-- Provenance + barcode + drink volume
alter table food_logs add column if not exists source text not null default 'photo'
  check (source in ('photo','text','drink','barcode'));
alter table food_logs add column if not exists barcode text;
alter table food_logs add column if not exists volume_oz numeric(6,1); -- drinks only

-- Personal frequent-foods library
create table if not exists food_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  brand        text,
  barcode      text,
  source       text not null check (source in ('text','drink','barcode')),
  calories     int not null,            -- per logged portion (the portion the user actually logs)
  protein_g    numeric(6,1) not null,
  carbs_g      numeric(6,1) not null,
  portion_desc text not null,           -- e.g. "1 glass (12 oz)", "1 serving (55g)"
  volume_oz    numeric(6,1),            -- hydrating drinks
  is_hydrating boolean not null default false,
  use_count    int not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  unique (user_id, name, portion_desc)
);
alter table food_items enable row level security;
create policy "food_items_own" on food_items for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists food_items_user_recent on food_items (user_id, last_used_at desc);
```

Also update `FoodLog` in `src/features/food/types.ts`: `storage_path: string | null`,
add `source`, `barcode`, `volume_oz`. Add a `FoodItem` interface mirroring `food_items`.
Check every UI usage of `meal.photo_url` / `storage_path` tolerates null (the GET route must
skip signed-URL generation when `storage_path` is null).

## Phase 2 — Text estimation API (powers Add Food AND Quick Drink)

`POST /api/health/food/estimate` — new route. Body:

```ts
{
  description: string          // "glass of orange juice" / "chicken breast"
  kind: 'food' | 'drink'
  answer?: string              // present on the second call, after user answers the follow-up
}
```

Call gpt-4o-mini with `response_format: { type: 'json_object' }`. System prompt requirements:

- If the description already pins down the quantity ("two eggs and toast", "12 oz OJ"),
  return a **final estimate**: `{ status: 'final', item_name, calories, protein_g, carbs_g,
  confidence, notes, portion_desc, volume_oz (drinks, null if not hydrating), is_hydrating }`.
- If quantity is ambiguous, return **one** follow-up: `{ status: 'question', question: string,
  options: string[] }` — `options` are 3–5 tappable amounts, realistic for the item
  (e.g. OJ → ["Small glass (8 oz)", "Large glass (12 oz)", "Bottle (15.2 oz)"]). Never ask
  more than one question: when `answer` is present in the request, you MUST return `final`.
- `is_hydrating`: true for water/juice/milk/sports drinks/iced tea; false for coffee espresso
  shots, alcohol, milkshakes-as-dessert. `volume_oz` only when hydrating.
- Drinks (`kind: 'drink'`): bias toward beverage interpretation of ambiguous names.

The route does NOT insert — it only estimates. Saving goes through Phase 3's insert route.
(Keeps the question round-trip stateless: client holds the estimate, posts it for saving.)

## Phase 3 — Manual insert API

`POST /api/health/food/log` — new route. Body: the final estimate object plus
`{ source: 'text' | 'drink' | 'barcode', barcode?: string }`. The route:

1. Inserts into `food_logs` (`storage_path: null`, `date` via the same 6am-rollover helper
   `rolledDate()` used in `food/route.ts` — extract it to a shared location, e.g.
   `src/features/food/date.ts`, instead of duplicating).
2. If `is_hydrating && volume_oz > 0` → also insert into `water_logs` (same date convention
   as `api/health/water/route.ts`).
3. Upserts into `food_items` on `(user_id, name, portion_desc)`: increment `use_count`,
   bump `last_used_at`.
4. Returns the inserted log (+ `water_logged: boolean`).

## Phase 4 — Barcode

### 4a. Lookup route — `GET /api/health/food/barcode/[code]`

Server-side fetch to Open Food Facts (free, no key):

```
https://world.openfoodfacts.org/api/v2/product/{code}?fields=product_name,brands,nutriments,serving_size,serving_quantity,quantity,product_quantity
```

- Send header `User-Agent: Atlas - personal nutrition app - lukadev` (OFF asks for this).
- Normalize to: `{ found: true, name, brand, per_100g: { calories, protein_g, carbs_g },
  per_serving: {...} | null, serving_size: string | null, package_grams: number | null }`.
  Nutriment keys: `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, and `_serving`
  variants. Guard every field — OFF data is community-sourced and often partial.
- Product missing or no usable macros → `{ found: false }` (HTTP 200, not 404 — the client
  branches on `found`).
- Wrap the OFF fetch in a 5s `AbortSignal.timeout` — it's a volunteer-run service.

### 4b. Scanner UI

- `npm install barcode-detector` (WASM ponyfill of the BarcodeDetector spec — needed because
  iOS Safari has no native support). Import lazily (`await import(...)`) only when the scanner
  opens, so the WASM never loads on normal page views.
- Full-screen overlay: `getUserMedia({ video: { facingMode: 'environment' } })` → `<video>` →
  detect loop (~5 fps via `setInterval` + `detect(video)`, formats `['ean_13','ean_8','upc_a','upc_e']`).
  Stop tracks + clear interval on close/unmount, no exceptions. Add a thin scan-line/reticle and a
  manual "type the number instead" input as escape hatch (camera denied, damaged barcode).
- On detection: vibrate if `navigator.vibrate` exists, close camera immediately, call 4a.

### 4c. Serving picker sheet (after `found: true`)

Bottom sheet in the style of existing modals (e.g. the measurement modal in `GymClient.tsx`):
product name + brand, then portion options as tap chips, computed from whichever data exists:

- "1 serving (Xg)" — when `per_serving` exists
- "Whole package (Xg)" — when `package_grams` exists
- "Half package"
- "Custom grams" — numeric input, macros = per_100g × g/100
- **"📷 Snap my portion"** — Luka's combo feature: opens the camera (reuse the existing photo
  input pattern), sends the photo to gpt-4o-mini vision with the product context:
  *"This is {name} ({per_100g} per 100g). Estimate how many grams are shown in the photo.
  Return JSON `{ grams, reasoning }`."* Then show "~Xg — Estimated from photo" as a selected
  chip the user can still override. Do NOT store this photo (skip the storage upload entirely;
  this is portion estimation, not a meal photo).

Footer: computed `calories / P / C` for the selection, updating live. Save → Phase 3 route with
`source: 'barcode'`, `barcode` set, `portion_desc` like "1 serving (55g)".

`found: false` → sheet offers: "Snap the nutrition label" (routes into the existing photo flow
with a hint prepended to `description`: "photo shows a nutrition facts label — read it exactly")
and "Type it instead" (routes into Add Food with the barcode digits discarded).

## Phase 5 — UI assembly in `FoodSection`

- Replace the single "+ Add food" button with the four-button row from the design above:
  primary mint pill "📷 Snap a meal" (existing flow, unchanged) + three secondary pills.
  Keep all existing photo flow behavior (multi-photo, description, pending previews) intact.
- **Add food / Quick drink sheet**: text input (autofocus) → "Estimate" → either final card
  (name, macros, editable before save) or the one follow-up question with option chips +
  free-text "Other amount". Answer → final card → Save. Show "Saving… / saved" states via the
  existing mutation patterns. For Quick drink, show preset chips above the input *before* typing:
  Water, Coffee, Orange juice, Protein shake, Soda, Beer — tapping a preset = submitting it as
  the description.
- When a drink also logged water, surface it: small "+12 oz water" confirmation line, and
  invalidate the water queries (`['health','water']` — check exact key in
  `src/features/health/queries.ts`) so the tracker updates.
- **Frequents row**: above the meal list, horizontal scroll of up to 10 `food_items` ordered by
  `last_used_at desc` (new `useFoodItems()` query → `GET /api/health/food/items`, new thin route).
  Tap → instant log via Phase 3 route (re-sending the stored macros) with optimistic update.
  Long-press or an ✕ affordance is NOT needed — keep it lean.
- Meal list rows: entries without photos render fine (no `<img>`); add a tiny source glyph —
  🥤 drink, ▮▮ barcode, ⌨ text — left of the name where the photo thumbnail would be.

## Phase 6 — Wiring & polish

- New queries/mutations in `src/features/food/`: `useEstimateFood()`, `useLogManualFood()`,
  `useBarcodeLoo kup()` (or plain fetch in-component for the lookup — fine either way),
  `useFoodItems()`. Invalidate `['food', date]`-style keys consistently with existing code.
- All sheets close on backdrop tap; camera/mic-style permissions failures show inline copy,
  never alerts.
- `ReadLints` the touched files; check `/tmp/atlas-dev.log` compiles clean.

## Acceptance Checklist

- [ ] "chicken breast" → asks "How much?" with gram/oz options → answer → saved with macros, no photo
- [ ] "two eggs and toast" → no question, straight to final card → saved
- [ ] Quick drink preset "Orange juice" → asks size → "Large glass (12 oz)" → saved as food AND +12 oz water, water tracker visibly updates
- [ ] Coffee (black) → saved, NO water log
- [ ] Scan a real EAN-13 (e.g. 3017620422003 = Nutella) on iPhone Safari → product sheet with serving chips → save
- [ ] Scan unknown barcode → fallback sheet with label-photo and type-it options
- [ ] "Snap my portion" returns gram estimate and macros scale accordingly
- [ ] Logged text/drink/barcode items appear in Frequents; tapping re-logs instantly
- [ ] Photo meal flow unchanged end-to-end
- [ ] Day totals include all sources; 6am rollover respected for all new inserts
- [ ] Remind Luka: run the new migration in Supabase SQL editor

## Out of Scope (do not build)

Editing food_items, fuzzy text search of OFF, nutrition label OCR as a separate pipeline
(it's just the existing photo flow + hint), offline barcode cache, fat/fiber macros
(app tracks calories/protein/carbs only).
