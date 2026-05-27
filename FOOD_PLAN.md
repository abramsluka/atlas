# Food Photo → AI Calorie Tracker

Take a picture of a meal, OpenAI estimates calories + protein + carbs, log accumulates into a daily total. Lives on the Health tab.

---

## Decisions (locked in)

- **Scope:** daily log with running total + per-meal macros (**calories, protein, carbs**). Skip fat for v1.
- **History:** browse past days. Tap a day, see meals + day total.
- **Photo storage:** Supabase Storage, private bucket (same pattern as progress photos).
- **Editing:** save what the AI says by default. Allow editing later from the meal detail / history view for the rare wrong call.
- **Vision model:** OpenAI `gpt-4o-mini` for meal photos. `OPENAI_API_KEY` is in `.env.local` ✓.
- **Day rollover:** match the supplement convention — meals logged before 6am count toward the previous day.
- **Image resize:** yes — resize to max 1024px on the client before upload. Cuts OpenAI tokens ~10x and upload time.
- **Daily targets:** **in scope for v1**, AI-calculated from current weight + target weight + pace. See section 10.

---

## 1. Migration

`supabase/migrations/20260525000007_food_logs.sql`

```sql
create table if not exists food_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,           -- 6am-rolled date (matches supplements)
  storage_path  text not null,           -- food-photos/{user_id}/{timestamp}.{ext}
  item_name     text not null,
  calories      int,
  protein_g     numeric(6,1),
  carbs_g       numeric(6,1),
  confidence    text check (confidence in ('low','medium','high')),
  ai_raw        jsonb,                   -- full OpenAI response for debugging / re-runs
  notes         text,
  taken_at      timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table food_logs enable row level security;

do $$ begin
  drop policy if exists "food_logs_own" on food_logs;
end $$;

create policy "food_logs_own" on food_logs for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists food_logs_user_date on food_logs (user_id, date desc);

-- Calorie / macro targets on the existing health_profile table
alter table health_profile add column if not exists target_weight_lbs numeric(5,1);
alter table health_profile add column if not exists cut_pace text check (cut_pace in ('slow','moderate','aggressive'));
alter table health_profile add column if not exists daily_calorie_target int;
alter table health_profile add column if not exists daily_protein_target_g int;
alter table health_profile add column if not exists daily_carbs_target_g int;
alter table health_profile add column if not exists target_reasoning text;        -- AI explanation, shown once
alter table health_profile add column if not exists target_calc_weight_lbs numeric(5,1);  -- weight used in last calc
alter table health_profile add column if not exists target_calculated_at timestamptz;
alter table health_profile add column if not exists linked_target_goal_id uuid references goals(id) on delete set null;
```

Plus a Storage bucket: `food-photos`, private, same RLS shape as `progress-photos`.

---

## 2. TypeScript types

`src/features/food/types.ts`

- `FoodLog` matching the row shape (with optional `photo_url` for signed URL on read)
- `FoodEstimate` — what the OpenAI route returns: `{ item_name, calories, protein_g, carbs_g, confidence, notes }`
- `DailyTotals` — derived: `{ calories, protein_g, carbs_g, mealCount }`

---

## 3. OpenAI integration

- Install `openai` package (`npm i openai`)
- New helper: `src/lib/openai.ts` — single `getOpenAI()` factory
- Prompt the model with the image + a strict JSON-mode request. Response format:

```json
{
  "item_name": "Chicken burrito bowl with brown rice and black beans",
  "calories": 720,
  "protein_g": 42,
  "carbs_g": 78,
  "confidence": "medium",
  "notes": "Assuming standard restaurant portion"
}
```

System prompt:
> You are a food calorie estimator. Look at the photo and return your best estimate of calories, protein in grams, and carbs in grams for the food shown. Be honest about confidence — "high" for clearly visible single items with known portions, "medium" for typical restaurant meals, "low" for ambiguous or partially visible food. Keep `item_name` short (under 80 chars). Return JSON only, no prose.

- Use `response_format: { type: "json_object" }` with explicit schema in the prompt
- Pass image as base64 data URL inline (simpler than signed-URL roundtrip)

---

## 4. API routes

### `POST /api/health/food` — log a new meal

- Accepts `multipart/form-data` with `photo` field
- Read auth user → service client
- Convert photo to base64, call OpenAI
- Upload original photo bytes to `food-photos/{user_id}/{date}_{timestamp}.{ext}`
- Insert `food_logs` row with the AI estimate + storage path
- Return the inserted row (with signed URL)

### `GET /api/health/food?date=YYYY-MM-DD` — list meals for a day

- Default to today's 6am-rolled date if no param
- Return meals ordered by `taken_at desc`
- Generate signed URLs (60-min expiry) for each photo

### `PATCH /api/health/food/[id]` — edit a meal

- Allow updating `item_name`, `calories`, `protein_g`, `carbs_g`, `notes`
- Verify ownership

### `DELETE /api/health/food/[id]`

- Verify ownership, delete the storage object AND the row

### `GET /api/health/food/history?days=14`

- Returns array of `{ date, calories, protein_g, carbs_g, meal_count }`
- For the history view + future sparklines

---

## 5. TanStack Query

`src/features/food/queries.ts`
- `useFoodLogs(date)` — meals for a specific day
- `useFoodHistory(days)` — daily totals

`src/features/food/mutations.ts`
- `useLogFood()` — POST with FormData
- `useUpdateFoodLog()` — PATCH
- `useDeleteFoodLog()` — DELETE

---

## 6. UI — Health tab section

New section on `/health`, placed between Wearables and Stack Tracker.

### Today's view (top)

```
┌──────────────────────────────────────┐
│ FOOD                  View history → │
│                                      │
│ 1,240 / 2,100 cal     ━━━━━━━──── 59%│
│ Protein  85 / 170g    ━━━━━─────  50%│
│ Carbs   142 / 220g    ━━━━━━━──── 65%│
│ 4 meals                              │
│                                      │
│ [+ Add food]   (white pill button)   │
└──────────────────────────────────────┘
```

If no target is set: hide the bars, show plain totals only (`1,240 cal · 85g P · 142g C · 4 meals`) and a small "Set a calorie target" prompt linking to the target setup flow (section 10).

Plus meal rows underneath:

```
[thumbnail] Chicken burrito bowl       720 cal
            42g P · 78g C  ·  1:42pm    [×]
```

- Tap a meal row → opens edit sheet (item_name, cal, protein, carbs, notes)
- Tap × → delete confirm modal (same pattern as journal/goals)

### Add food flow

`+ Add food` button →
1. `<input type="file" accept="image/*" capture="environment">` to open camera (same as progress photos)
2. **Client-side resize:** draw to a `<canvas>` at max 1024px on the longer edge, export as JPEG quality 0.85
3. POST resized blob to `/api/health/food` as `multipart/form-data` (no preview confirmation — keeps it fast)
4. Show a streaming-style loading state ("Estimating…") for ~2–4s while OpenAI responds
5. On success, the meal appears in the list with a soft fade-in

Resize util: `src/features/food/resize.ts` — pure browser function `resizeImage(file: File, maxDim: number): Promise<Blob>`. ~30 lines.

---

## 7. History sub-page

`/health/food/page.tsx` + `FoodHistoryClient.tsx`

- Date picker at top (default today)
- Day total at the top: cal / P / C / meal count
- Scrollable meal list with thumbnails
- Same edit/delete actions as the today view
- A small 14-day calorie sparkline above the day picker

---

## 8. Edit sheet (shared)

Bottom-sheet modal (same shape as the Goals add sheet):

- Photo thumbnail at top (read-only)
- Inputs: item name, calories, protein (g), carbs (g)
- Optional notes textarea
- [Cancel] [Save]

---

## 9. Feed food into the Health AI coach

The Health coach already pulls supplements + caffeine + water + Oura. Add food when ready:

- Pull last 7 days of food daily totals
- Add to the system prompt: "If their daily calorie/protein is wildly inconsistent or trending in a notable direction, mention it. Don't moralize — be observational. Compare against their daily targets when set."

Defer this until after the basic food flow works.

---

## 10. AI-determined daily calorie/macro target

The user sets a **target weight** and a **pace**; the AI calculates daily calorie / protein / carb targets. Recalculation prompted whenever the user logs a new body weight.

### 10.1 Where it lives

- **Source of truth:** `health_profile` (target_weight_lbs, cut_pace, daily_*_target columns, target_calculated_at).
- **Mirror in Goals tab:** when target weight is set/changed, upsert a numeric Goal called `"Reach {target} lbs"` with `direction = 'descending'`, `target_value = target lbs`, `current_value = latest body weight`, `start_value = current weight at the time the target was first set`, `unit = 'lbs'`. The Goals tab now supports descending numeric goals (shipped as a prerequisite — see migration `20260525000007_goal_direction.sql`).
- **Mirror sync:** when body weight changes, update the Goal's `current_value` too. When `target_weight_lbs` changes in the profile, update the Goal's `target_value`. Tie the goal to the profile by a `linked_target_goal_id uuid` column on `health_profile` (added in the food migration).
- **Settings UI:** add a "Target" subsection to the Health profile settings (already exists in WaterSection settings modal). Inputs: target weight (number), cut pace (segmented control: Slow / Moderate / Aggressive).

### 10.2 Pace presets

- **Slow** — 0.5 lb/week deficit (~250 cal/day under maintenance)
- **Moderate** — 1 lb/week (~500 cal/day under)
- **Aggressive** — 1.5 lb/week (~750 cal/day under)

The AI applies the matching deficit on top of estimated maintenance (Mifflin-St Jeor + activity multiplier). The user can change pace at any time → recalculate.

### 10.3 Calculation flow

New endpoint: `POST /api/health/calorie-target/calculate`

Inputs (read from health_profile + latest body_weight_logs):
- Current weight (latest `body_weight_logs` entry, fallback to `health_profile.weight_lbs`)
- Target weight
- Age, sex (from health_profile)
- Activity hrs/week (from health_profile)
- Cut pace

Calls Claude Sonnet 4.6 with a structured JSON response asking for:
```json
{
  "daily_calories": 1850,
  "protein_g": 175,
  "carbs_g": 180,
  "reasoning": "Based on your current 175 lbs, moderate activity, and a moderate cut pace, I estimated maintenance around 2,350 cal and applied a 500 cal deficit. Protein at 1g/lb to preserve muscle while cutting."
}
```

The AI does both the BMR math and the protein/carb split. We give it a system prompt that anchors it to standard formulas so it doesn't hallucinate weird numbers. If we ever want pure determinism we can drop the LLM and use Mifflin-St Jeor in code, but the LLM is ~$0.001 per call and adds a real explanation.

On success: update health_profile with the new targets, `target_calc_weight_lbs` = the weight used, `target_calculated_at` = now, `target_reasoning` = AI explanation. Also upsert the mirrored Goal.

### 10.4 Recalculate-on-new-weight popup

In the Gym tab's body weight entry flow:
- After a successful `useCreateBodyWeight()` mutation, check: does the user have `daily_calorie_target` set AND is the new weight ≥ 0.3 lbs different from `target_calc_weight_lbs`?
- If yes, show a modal:
  ```
  New weight logged: 173.4 lbs
  Last target was set at 175 lbs.
  Recalculate your daily calorie target?
  [Skip]  [Recalculate]
  ```
- "Recalculate" hits the same endpoint with the new weight.

The 0.3 lb threshold avoids prompting for noise. We can tune that — making it configurable would be over-engineering for v1.

### 10.5 Show target setup prompt

If the user has no `daily_calorie_target` set, the food section shows a "Set a calorie target" link instead of progress bars. Tapping opens the target setup sheet:

```
Target weight        [_____]  lbs
Pace                 [Slow] [Moderate] [Aggressive]

[Calculate target]   (white pill, streams ~2s)

Result preview:
  1,850 cal · 175g P · 180g C
  "Based on your current 175 lbs..." (reasoning text)

[Cancel]  [Save target]
```

### 10.6 Where to show the current target + reasoning

- Food section "Today" view: progress bars (cal / P / C) against target.
- Health profile settings: target weight, pace, "recalculate now" button, AI reasoning displayed below the inputs.
- Health AI coach context (section 9): include current target + adherence over last 7 days.

---

## Build order

1. Food migration + health_profile columns + storage bucket
2. Food types + OpenAI helper + image resize util
3. `POST /api/health/food` end-to-end (resize → upload → AI → insert)
4. `GET /api/health/food` + TanStack hook
5. Today's food view section on `/health` (totals only at first, no target bars)
6. Edit sheet + PATCH/DELETE endpoints
7. History sub-page at `/health/food` with date picker
8. **AI target feature (section 10):**
   - Settings UI for target weight + pace
   - `/api/health/calorie-target/calculate` endpoint
   - Wire progress bars into the food section
   - Mirror to Goals tab
   - Recalc popup on new body weight
9. Feed food + targets into the Health AI coach (section 9)

---

## Open questions / known unknowns

- **Cost ceiling.** ~$0.0005 per food photo + ~$0.001 per target recalc. Fine for personal use.
- **Image size.** Phone photos are 3–8 MB; resize to max 1024px JPEG q=0.85 client-side before upload.
- **Failure mode.** If OpenAI returns garbage JSON or fails, surface the error, don't save anything. No row stored without a valid estimate.
- **Privacy.** Food photos sent to OpenAI. Not retained on the API tier but requests are logged.
- **Goals tab direction:** shipped as a prerequisite — numeric goals now support ascending and descending with a `start_value` for proper progress math.

---

## Open questions / known unknowns

- **Cost ceiling.** ~$0.0005 per photo is fine for personal use. No rate-limiting needed v1.
- **Image size.** Mobile photos can be 3–8 MB. Should we resize before upload to save bandwidth and OpenAI tokens? Probably yes — resize to max 1024px on the client before POST. Adds ~30 lines but cuts the OpenAI bill by ~10x and the upload time dramatically.
- **Failure mode.** If OpenAI returns garbage JSON or fails, what do we do? v1: surface the error, don't save anything, let user retry. Don't store a row without a valid estimate.
- **Privacy.** Food photos sent to OpenAI. Worth noting in your own head — these are not stored by OpenAI on the API tier, but the request is logged.
