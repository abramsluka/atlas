# Spec: Photo Meal Follow-Up Refinement — Snap-a-Meal v2

> **For the implementing agent:** This is an executable spec. Read it fully, then implement in the
> phase order given. Every referenced file path is real. Follow the existing patterns named here —
> do not invent new architecture. When this spec and the codebase disagree on a detail (e.g. a
> column name), trust the codebase and keep moving.

## Goal

After **Snap a meal**, the meal is logged immediately with a vision estimate (current behavior).
Then, **in the today's meal list** — not a separate modal — show an expandable refinement card
that matches Luka's reference UI:

```
┌─────────────────────────────────────────────────────────┐
│ [thumb] avocado          2P · 9C · 15F        160 kcal  │
│                         ESTIMATE badge                  │
│ ┃ (green left border)                                   │
│ ┃ Is this a single half or a whole avocado? … ±80 kcal  │
│ ┃ [one half] [whole] [unsure…] [Something else]         │
│ ┃ Don't know · skip                                     │
│ ┃                                                       │
│ ┃ The photo shows only the skin… is there more on the   │
│ ┃ plate outside the frame?                              │
│ ┃ [just this] [part of meal] [unsure] [Something else]  │
│ ┃ Don't know · skip                                     │
│                                                         │
│ + add a note    ☆ favorite    delete                    │
└─────────────────────────────────────────────────────────┘
```

**New capabilities vs today:**

1. **Follow-up questions** after photo log — same interaction model as Add food wizard (chips,
   **Something else** inline text, **Don't know · skip**), powered by the **stored photo** +
   initial estimate + any user description from the snap sheet + growing `answers[]`.
2. **Fat (F)** tracked and displayed alongside P and C everywhere food macros appear in this card.
3. **AI reasoning** shown in italic under each question (the "thought process" line), optionally
   with a calorie-impact hint like `±80 kcal`.
4. **Collapsible card** — expanded by default when refinement is still open; user can collapse to
   the compact row; tap header to expand again.
5. **Inline actions** — `+ add a note`, `☆ favorite` (saves to frequents library), `delete`
   (no separate edit sheet required for these actions).
6. **Notes** — user description typed before "Log it" is stored and shown; user can append/edit
   notes later via `+ add a note`.

Photo meals without open refinement still use the compact list row (current style). Tapping opens
`MealEditSheet` for full manual edit (keep that).

## Existing Code Map (read these before writing)

| Path | What it is |
|---|---|
| `src/app/health/HealthClient.tsx` → `FoodSection` | Meal list, snap flow, `MealEditSheet`. Replace compact rows for **photo + open refine** with new card component. |
| `src/app/health/FoodEntry.tsx` | Add food / drink wizard chips + `chipClass()` — reuse chip styling patterns here. |
| `src/app/api/health/food/route.ts` | `POST` photo meal — extend vision prompt + insert fields. |
| `src/app/api/health/food/estimate/route.ts` | Text wizard — copy question/answer JSON shapes and AI rules. |
| `src/app/api/health/food/[id]/route.ts` | `PATCH` / `DELETE` — extend `UpdateSchema` for `fat_g`, refine state. |
| `src/app/api/health/food/log/route.ts` | Manual insert + `food_items` upsert — favorite reuses this upsert pattern. |
| `src/features/food/types.ts` | Add `fat_g`, refine types. |
| `src/features/food/mutations.ts` | Add `useRefinePhotoMeal()`, `useFavoriteFoodLog()`. |
| `supabase/migrations/20260611000002_food_logging_v2.sql` | `food_items` table — extend `source` check to include `'photo'`. |

**API route auth pattern (mandatory):** `createClient()` only for `auth.getUser()`;
`createServiceClient()` for ALL db reads/writes. 401 JSON on no user.

**Reminder:** migrations are NOT auto-applied. End your work by telling Luka exactly which
migration file to run in the Supabase SQL editor.

## UX Rules (match the screenshot)

| Element | Behavior |
|---|---|
| Header row | Thumbnail, item name, `Ng P · Ng C · Ng F`, calories in mint/green, **ESTIMATE** pill when `refine_status !== 'done'` OR `confidence !== 'high'` |
| Green left border | 2px `#6ee7b7` vertical bar on the refine block only |
| Question text | Italic, zinc-400; include AI `reasoning` string; append `±Nkcal` when `calorie_delta` provided |
| Option chips | Wrap grid; one selected per active question; selected = emerald border (reuse `chipClass` from `FoodEntry.tsx`) |
| Something else | Separate chip; expands inline text input below chips |
| Don't know · skip | Muted text link under chips; sends `skipped: true` |
| Multiple questions | **Stack vertically.** Answered questions stay visible with their selected chip highlighted. Only the **latest unanswered** question is interactive. (Screenshot shows Q1 answered + Q2 active.) |
| Collapse | Chevron on header row toggles refine block; default **expanded** when `refine_status === 'open'` |
| Footer actions | `+ add a note` opens inline textarea; `☆ favorite` toggles star + upserts `food_items`; `delete` uses existing delete confirm pattern |
| Section label | Optional small caps label above card: **OTHER** (or item category if AI provides one — default `"OTHER"` is fine) |

**Do not** block logging on refinement — photo is saved immediately; refinement is optional but
encouraged (expanded by default).

## Phase 1 — Database

New migration `supabase/migrations/<today>000001_photo_meal_refine.sql`:

```sql
-- Fat macro
alter table food_logs add column if not exists fat_g numeric(6,1);

-- Photo refinement state
alter table food_logs add column if not exists refine_status text not null default 'done'
  check (refine_status in ('open','done'));
alter table food_logs add column if not exists user_description text; -- typed before "Log it"

-- Allow photo-sourced favorites in frequents library
alter table food_items drop constraint if exists food_items_source_check;
alter table food_items add constraint food_items_source_check
  check (source in ('text','drink','barcode','photo'));

-- Backfill: existing photo logs are done; non-photo already done
update food_logs set refine_status = 'done' where refine_status is null;
update food_logs set refine_status = 'open', source = 'photo'
  where storage_path is not null and refine_status = 'done'
  and created_at > now() - interval '1 day'; -- optional: only recent; or skip backfill and only new logs open
```

**Backfill policy for implementer:** New photo logs get `refine_status = 'open'`. Do **not**
re-open old logs — migration default `'done'` is correct for existing rows; only `POST` photo sets
`'open'`.

Store refine conversation in existing `ai_raw` jsonb (no new column):

```ts
ai_raw: {
  initial: { ...openai first response... },
  refine: {
    answers: Array<{ question: string; answer: string; skipped?: boolean }>,
    questions: Array<{ question: string; reasoning: string; options: string[]; calorie_delta?: number }>,
    // questions[] grows: each answered round appends the next question object
  }
}
```

Update `FoodLog` in `src/features/food/types.ts`: add `fat_g`, `refine_status`, `user_description`.
Extend `FoodEstimate` with `fat_g`. Add `PhotoRefineResponse` types (mirror estimate wizard).

## Phase 2 — Initial photo POST changes

File: `src/app/api/health/food/route.ts`

### Vision prompt changes

- Return JSON: `item_name, calories, protein_g, carbs_g, fat_g, confidence, notes, category`
  (`category` optional string e.g. `"breakfast"` / `"OTHER"` — default UI label).
- `fat_g` required (number).
- If `confidence !== 'high'`, also return a **first refine question** inline:

```json
{
  "refine_question": {
    "question": "Is this a single half or a whole avocado?",
    "reasoning": "The photo is zoomed in on just the skin…",
    "options": ["one half (~70-90g)", "whole avocado (~150-200g)", "unsure / part of larger meal"],
    "calorie_delta": 80
  }
}
```

If `confidence === 'high'` and description is very specific, `refine_question` may be null.

### Insert changes

```ts
{
  fat_g,
  source: 'photo',
  refine_status: refine_question ? 'open' : 'done',
  user_description: description || null,
  notes: description || estimate.notes || null,  // user text wins; AI notes fallback
  ai_raw: {
    initial: parsed,
    refine: refine_question
      ? { answers: [], questions: [refine_question] }
      : { answers: [], questions: [] },
  },
}
```

Response includes full `FoodLog` + `photo_url` (unchanged).

## Phase 3 — Refine API

`POST /api/health/food/[id]/refine` — new route.

**Body:**

```ts
{
  answer?: {
    question: string
    answer: string
    skipped?: boolean
  }
  // omit answer on first client call after POST if POST didn't include refine_question
  // (edge case: fetch first question for old logs — optional)
}
```

**Server flow:**

1. Load `food_logs` row; 404 if not owner or no `storage_path` (photo-only).
2. Read `ai_raw.refine`; append `answer` to `answers[]` when provided.
3. Fetch photo from `food-photos` storage → base64 data URL (same as POST).
4. Call `gpt-4o-mini` with vision + JSON mode. Pass:
   - photo(s)
   - `item_name`, current macros, `user_description`, `notes`
   - full `answers[]` history
   - count of questions asked; **hard cap 3** (same as text estimate)

**Response shapes:**

**More questions** (under cap, still ambiguous):

```ts
{
  status: 'question'
  question: string
  reasoning: string
  options: string[]          // 3–5 chips
  calorie_delta?: number     // optional ± impact hint
  step: number               // 1-based
}
```

Append new question object to `ai_raw.refine.questions[]`. Do **not** update macros yet
(or update lightly — prefer batch update on `final`).

**Final** (enough info OR cap reached):

```ts
{
  status: 'final'
  item_name: string
  calories: number
  protein_g: number
  carbs_g: number
  fat_g: number
  confidence: 'low' | 'medium' | 'high'
  notes: string              // AI summary; don't overwrite user notes unless empty
}
```

On `final`: `UPDATE food_logs` macros + `refine_status = 'done'`, merge `ai_raw.refine.answers`,
set `confidence`, optionally append AI note to `notes` only if `notes` was null.

On `question`: persist intermediate state to `ai_raw` only; keep `refine_status = 'open'`.

**Skip behavior:** `skipped: true` with empty answer → model assumes default and returns next
question or `final`.

Reuse AI behavior rules from `estimate/route.ts` (one question at a time, realistic chips,
never re-ask answered questions).

## Phase 4 — Favorite API

`POST /api/health/food/[id]/favorite` — new route.

- Load log; upsert `food_items` on `(user_id, name, portion_desc)` where
  `portion_desc = user_description || 'photo meal'` or `item_name` if no description.
- `source: 'photo'`, macros from current log row, `barcode: null`, `is_hydrating: false`.
- Increment `use_count` / `last_used_at` on repeat favorite.
- Return `{ favorited: true, food_item_id }`.

Client: star fills yellow on success; Frequents row invalidates `['food-items']`.

No "unfavorite" endpoint needed — star is one-way save to library.

## Phase 5 — PATCH extensions

`src/app/api/health/food/[id]/route.ts` — extend `UpdateSchema`:

```ts
fat_g: z.number().min(0).optional(),
notes: z.string().max(500).nullable().optional(),
refine_status: z.enum(['open', 'done']).optional(), // allow manual dismiss
user_description: z.string().max(500).nullable().optional(),
```

Allow user to dismiss refinement without answering: client sets `refine_status: 'done'` via PATCH
(collapsed card, ESTIMATE badge hides if confidence is high enough).

## Phase 6 — UI: `PhotoMealCard` component

New file: `src/app/health/PhotoMealCard.tsx` (keeps `HealthClient.tsx` smaller).

Props: `meal: FoodLog`, `date: string`, `defaultExpanded?: boolean`.

**Collapsed row** (shared header — always visible):

- Thumbnail, name, `P · C · F`, calories, ESTIMATE badge if applicable, chevron.

**Expanded body** (when `refine_status === 'open'` OR user expanded):

- Green left-border column with all questions from `ai_raw.refine.questions`.
- For each question index `i`:
  - If `i < answers.length` → show question reasoning + **selected chip** (disabled, highlighted).
  - If `i === answers.length` → active question with interactive chips + skip + something else.
  - If `i > answers.length` → don't render (future questions not yet generated).

**Answering:**

- Tap chip → select; tap **Something else** → text field; selecting a chip for active question
  immediately calls `useRefinePhotoMeal` (no separate Next button — tap chip = submit, matches
  screenshot quick-tap UX). **Alternative acceptable:** chip select + small Next link if tap-to-submit feels too aggressive — prefer **tap chip = submit** for speed.
- Skip link → submit with `skipped: true`.
- On `status: 'question'` response → append to local state, stay expanded.
- On `status: 'final'` → update meal in query cache optimistically, collapse refine block,
  `refine_status` becomes `done`.

**Footer:**

- `+ add a note` → inline textarea; save on blur or small Save via `useUpdateFoodLog`.
- `☆ favorite` → `useFavoriteFoodLog`.
- `delete` → parent `confirmDeleteId` pattern.

**Integration in `FoodSection` meal list:**

```tsx
meal.source === 'photo' && meal.refine_status === 'open'
  ? <PhotoMealCard meal={meal} date={today} defaultExpanded />
  : <CompactMealRow ... />  // current row; click → MealEditSheet
```

After POST snap succeeds, invalidate `['food-logs', date]` — new card appears expanded at top.

**Totals row:** include `fat_g` in reduce if you add a fat target later; for now show fat on
cards only. Day summary line can stay cal · P · C unless trivial to add F.

**`MealEditSheet`:** add fat input field; show `fat_g` in edit grid (4th column or replace layout).

## Phase 7 — Mutations & cache

`src/features/food/mutations.ts`:

```ts
useRefinePhotoMeal()   // POST /api/health/food/[id]/refine
useFavoriteFoodLog()   // POST /api/health/food/[id]/favorite
```

`onSuccess` for refine: update `['food-logs', date]` cache entry for that id in-place (don't
full refetch required).

Extend `useUpdateFoodLog` / `useDeleteFoodLog` patches for `fat_g`.

## Phase 8 — Display fat elsewhere (minimal)

- `PhotoMealCard` header: `2P · 9C · 15F` format (screenshot).
- Compact meal row: `Ng P · Ng C · Ng F` for photo meals (optional for non-photo).
- `FoodHistoryClient.tsx` meal rows: add F if trivial (same pattern).

Do **not** add daily fat target to health profile in this spec.

## Acceptance Checklist

- [ ] Snap avocado photo without description → logs immediately → expanded card with ESTIMATE badge + Q1
- [ ] Q1 shows italic reasoning + `±Nkcal` hint when AI provides it
- [ ] Tap chip → submits → macros update on final OR Q2 appears below with Q1 answered visible
- [ ] Something else → type custom answer → submits
- [ ] Don't know · skip → next question or final with defaults
- [ ] After 3 questions, next response is always `final`
- [ ] Collapse chevron hides refine block; expand again works
- [ ] `+ add a note` shows user description from snap sheet; can edit/save later
- [ ] ☆ favorite adds item to Frequents row (source photo)
- [ ] Delete removes meal + photo from storage
- [ ] Fat shown on card (`P · C · F`); `fat_g` stored in DB
- [ ] High-confidence clear meal (e.g. labeled package) may skip refine (`refine_status = 'done'`, no card body)
- [ ] Dismiss without answering (collapse + PATCH `refine_status: done` OR "Done" link) — optional small "Skip refinement" text link
- [ ] Photo POST + existing Add food / drink / scan flows unchanged
- [ ] Remind Luka: run new migration in Supabase SQL editor

## Out of Scope (do not build)

- Re-opening refinement on old `done` meals
- Multi-photo refine (only primary `storage_path` image used; multi-photo POST still works for initial estimate)
- Daily fat target in health profile
- AI-generated meal categories beyond static "OTHER" label
- Un-favorite / edit food_items from this card
