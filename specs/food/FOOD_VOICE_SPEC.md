# FOOD_VOICE_SPEC.md — Voice Food Logging (Atlas Orb V2)

> Follows [VOICE_SPEC.md](VOICE_SPEC.md). V1 shipped the Orb + Mentor logging for sets, supplements, weight, water, caffeine, and notes, and deliberately deferred food because food has its own multi-round estimation flow. This spec adds a `log_food` action so "I had a chicken burrito and a protein shake" logs through the Orb (and Mentor) with the same confirm-card safety model.

## 0. Context — what already exists

Food is the one log type the V1 Orb ignores, because unlike a supplement dose (a single row) a food log needs a calorie/macro estimate and often a portion clarification. That machinery already exists on the Health page:

- **Estimate wizard** — `POST /api/health/food/estimate` (OpenAI `gpt-4o-mini`, stateless). Body `{ description, kind: 'food'|'drink', answers: WizardAnswer[] }`. Returns either `{status:'question', question, options[]}` or `{status:'final', item_name, calories, protein_g, carbs_g, confidence, notes, portion_desc, volume_oz, is_hydrating}`. Hard cap **3 questions**; portion-style rules (`src/features/food/portionStyle.ts`) baked into its prompt. Hook: `useEstimateFood`.
- **Commit** — `POST /api/health/food/log`. Body is `ManualLogInput` = `EstimateFinal` (minus `status`) + `{ source: 'text'|'drink'|'barcode', barcode?, brand? }`. Requires `item_name` + finite `calories`. Server sets `date = rolledDate()` (6am rollover). **Side effects:** a hydrating drink with `volume_oz` also inserts a `water_logs` row (returns `water_logged`); upserts the `food_items` "frequents" library. Hook: `useLogManualFood` → invalidates `['food-logs', date]`, `['food-items']`, and `['health','water']`.

So the write path and the executor hook are done. The only new work is **getting from a spoken sentence to a validated `ManualLogInput`, and rendering it as an Orb confirm card.**

## 1. What this is

A `log_food` action kind for the Orb and Mentor. You say what you ate; Atlas estimates it, asks at most one portion question when it matters (as Orb clarify chips), and proposes a food confirm card. Tapping it writes through `useLogManualFood` — same row, same water side-effect, same frequents library as the manual Health-page flow. Nothing writes until you confirm.

## 2. Done / Wrong

**Done looks like:**
- "I had two eggs and toast" → one food card ("~220 cal, 14g P") → confirm → row in `food_logs`, Health page reflects it.
- "I had a chicken burrito" (ambiguous portion) → one clarify question with realistic chips ("Chipotle", "Homemade", "Taco Bell") → answer → food card → confirm.
- "I drank a 12 oz orange juice" → food card marked hydrating → confirm → `food_logs` row **and** a 12 oz `water_logs` row (the existing side-effect fires unchanged).
- Multiple foods in one utterance → multiple food cards, "Confirm all" works.
- Works from the Orb on any page and inline in Mentor, both already wired for actions/clarify.

**Wrong looks like (guardrails):**
- ❌ A food row written without a confirmed card. Same contract as every other action.
- ❌ Inventing a specific calorie number with false confidence — low-confidence estimates must set `confidence: 'low'` and the card must show it.
- ❌ Re-implementing the water side-effect or the frequents library in a new endpoint. Commit MUST go through `POST /api/health/food/log` via `useLogManualFood`.
- ❌ Endless questioning. Cap at one clarify in the Orb path (the model may skip it entirely); never block a log on portion precision.
- ❌ Touching the photo-log flow (`/api/health/food` multipart) or the photo refine flow — those stay for the Health page.

## 3. Architecture — the decision

Two ways to turn a transcript into an estimate. **Recommended: B.**

### Option B (recommended) — Claude estimates via the `log_food` tool

Add a `log_food` tool to the shared assistant tool set (`src/features/assistant/tools.ts`). Claude, which is already parsing the whole utterance, estimates `item_name / calories / protein_g / carbs_g / portion_desc / is_hydrating / volume_oz / confidence` directly, using the **same portion-style rules** injected into its system prompt (import `PORTION_STYLE_RULES`). When a portion is genuinely ambiguous and high-impact, Claude calls the **existing native `clarify` tool** (chips already render in both surfaces) instead of guessing. The resolved action is a `log_food` card; confirm → `useLogManualFood` with `source: 'text'` (or `'drink'` when `is_hydrating`).

- **Pro:** fits the Orb's architecture exactly — one brain, one clarify mechanism, `log_food` is just another action kind. No second AI to drive, no wizard state to hold across turns. Multi-item ("burrito and a shake") falls out for free as parallel tool calls, which the OpenAI wizard can't do.
- **Con:** two estimators exist (Claude for voice, `gpt-4o-mini` for the manual/photo Health UI), so the *same* food described identically could differ by a handful of calories between entry points. Acceptable: both are estimates, and a voice log vs. a typed log already differ because the wording differs. If number-parity ever becomes a real complaint, switch that action to Option A.

### Option A (fallback) — drive the existing OpenAI wizard

The Orb calls `/api/health/food/estimate`, surfaces its `question`/`options` as clarify chips, accumulates `answers[]` across turns, and on `status:'final'` proposes the card. Identical numbers + portion UX to the Health page.

- **Con:** the Orb/Mentor must hold per-food wizard state (`description` + `answers[]`) and pump a second model's Q&A loop through a stream built around Claude's own tool calls — a real state-machine addition, and it can't batch multiple foods. Only worth it if estimate-consistency is a hard requirement.

**Recommendation: build B.** It's an afternoon (one tool + one action kind + one card + one executor branch) versus a multi-day wizard-state integration, and it keeps the Orb coherent.

## 4. The `log_food` action

### 4.1 Contract — add to `src/features/assistant/actions.ts`

```ts
| {
    kind: 'log_food'
    item_name: string
    calories: number
    protein_g: number
    carbs_g: number
    portion_desc: string
    is_hydrating: boolean
    volume_oz: number | null
    confidence: 'low' | 'medium' | 'high'
    notes: string
  }
```

`describeAction` card copy: title `Log ${item_name}`, detail `${calories} cal · ${protein_g}g P · ${carbs_g}g C · ${portion_desc}${is_hydrating && volume_oz ? ` · +${volume_oz}oz water` : ''}${confidence === 'low' ? ' · rough estimate' : ''}`.

### 4.2 Tool — add to `buildAssistantTools` in `tools.ts`

`log_food` with the fields above as its schema, `strict`-ish description: "Call when Luka says he ate or drank something. Estimate calories/macros from the description using the portion rules. Set is_hydrating + volume_oz for water/juice/milk/sports drinks/soda; false for coffee/alcohol/milkshakes. If a portion is genuinely ambiguous AND high-impact, call clarify with realistic options instead of guessing; otherwise estimate and set confidence honestly." Inject `PORTION_STYLE_RULES` into the system prompt of both routes (append to `catalogBlock` or `ACTION_RULES`).

### 4.3 Resolver — `resolveToolCall` in `tools.ts`

Validate: `item_name` non-empty, `calories` finite ≥ 0, macros coerced to ≥ 0 numbers, `volume_oz` only kept when `is_hydrating`, `confidence` ∈ enum (default `'low'`). Return the `log_food` action or `null`.

### 4.4 Executor — `useAssistantActions.ts`

Add a `case 'log_food'` that calls `useLogManualFood().mutateAsync({ ...fields, source: a.is_hydrating ? 'drink' : 'text' })`. That's the whole write — the endpoint handles the date, the water row, and the frequents upsert.

## 5. Files

| File | Change |
|---|---|
| `src/features/assistant/actions.ts` | add `log_food` to the union + `describeAction` case |
| `src/features/assistant/tools.ts` | add `log_food` tool; inject `PORTION_STYLE_RULES`; add resolver case |
| `src/features/assistant/useAssistantActions.ts` | add `useLogManualFood` + `case 'log_food'` |
| (ActionCard, Orb, Mentor) | no change — generic over action kinds already |

Untouched: `/api/health/food/*` routes, the photo + refine flows, `useEstimateFood`, the Health-page manual UI.

## 6. Edge cases

- **Ambiguous portion** → Claude calls `clarify` with realistic chips (reuse the estimate prompt's chip examples). One question max in this path.
- **Hydrating drink** → `is_hydrating: true` + `volume_oz`; the `/log` endpoint fires the water side-effect automatically. Card shows "+Noz water".
- **Multiple items** → parallel `log_food` calls → multiple cards → "Confirm all".
- **Pure water** ("drank 20 oz of water") → this stays a `log_water` action (V1), not `log_food`. The prompt must route plain water to `log_water`; `log_food` is for food + caloric/flavored drinks. Document this split so they don't double-fire.
- **Low confidence** → `confidence: 'low'`, card says "rough estimate", still one tap to log.
- **Barcode/photo** → out of scope; those stay on the Health page.

## 7. Verification

1. `npm run dev`, `/tmp/atlas-dev.log` clean.
2. Authenticated route test (same harness as V1): "two eggs and toast" → single `log_food` action with sane macros; confirm via `useLogManualFood`; psql shows the `food_logs` row with today's `rolledDate`.
3. "12 oz orange juice" → `log_food` with `is_hydrating:true, volume_oz:12`; confirm → both a `food_logs` row and a `water_logs` row (verify `water_logged:true` + psql).
4. "chicken burrito" → clarify chips → answer → card → confirm.
5. "a burrito and a protein shake" → two cards → Confirm all → two rows.
6. "drank 20 oz of water" → routes to `log_water` (V1), NOT `log_food` — no double log.
7. Health page food list + rings reflect the new rows without refresh (shared query keys already invalidated by the hook).

## 8. Deferred (still out, even for this V2)

- **Photo/barcode via voice** — the camera flows stay manual.
- **Editing macros on the card before confirm** — v1 of food-voice is confirm-or-dismiss; inline macro editing is a later polish.
- **Reconciling the two estimators** — only revisit (via Option A) if voice-vs-manual number drift becomes a real complaint.
