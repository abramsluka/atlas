# Food Coach Spec

Three features, same section of the Health screen, built in order.

## What We're Building

**Feature 1 — Per-meal blurb**
After every meal is logged, a 1-2 sentence AI reaction auto-streams inline under that meal's card. "Solid protein hit — salmon's a great choice post-workout." Stays there on reload. Collapsed for older meals, expanded for the most recent.

**Feature 2 — Today's Fuel summary**
Above the Ask your coach thread: a "Today's Fuel" block that shows the coach's read on your day so far. Placeholder until you've logged at least one meal. Tap to generate; small refresh button to regenerate after logging more meals. Knows your macros vs target + any workout today.

**Feature 3 — Ask your coach thread**
Below Today's Fuel: preset quick-tap chips + a free-text input. Each question/response pair appends to a scrollable thread that persists for the day. Responses stream inline.

---

## Placement in HealthClient

Inside `FoodSection`, after the meal list and before the "View history →" link:

```
[meal list]
[FoodCoachSection]   ← new component
  [Today's Fuel block]
  [Ask your coach thread]
[View history →]
```

---

## DB Schema

Migration: `supabase/migrations/20260612000001_food_coach.sql`

```sql
-- 1. Per-meal inline coach feedback (1:1 with food_logs)
alter table food_logs add column if not exists coach_feedback text;

-- 2. Daily coach thread (Today's Fuel summary + Ask your coach Q&A)
create table if not exists food_coach_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  role          text not null check (role in ('user', 'assistant')),
  content       text not null,
  chip_label    text,                              -- null for typed questions
  is_summary    boolean not null default false,   -- true = Today's Fuel entry
  created_at    timestamptz not null default now()
);
alter table food_coach_messages enable row level security;
create policy "food_coach_own" on food_coach_messages for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists food_coach_messages_user_date
  on food_coach_messages (user_id, date, created_at);
```

---

## API Routes

### POST `/api/health/food/[id]/coach`
Per-meal instant reaction. Called automatically after every log.

**Auth:** standard pattern (createClient auth, createServiceClient db).

**Logic:**
1. Load the food log row (item_name, calories, protein_g, carbs_g, fat_g, source, taken_at, notes).
2. Get time-of-day label from `taken_at`: morning / midday / afternoon / evening.
3. Build a short user message: `"${item_name} — ${calories} cal, ${protein_g}g protein, ${carbs_g}g carbs, ${fat_g != null ? fat_g + 'g fat' : ''}, logged at ${timeLabel}."`
4. Stream from haiku with system prompt (see below), save accumulated text to `food_logs.coach_feedback`.
5. Return `ReadableStream` (same pattern as gym coach).

**System prompt:**
```
You are a terse, direct nutrition coach inside a personal health app. The user just logged a meal. Give 1-2 sentences of honest, specific feedback on this meal — what's good about it, any notable macros, quick suggestion if relevant. No filler, no "Great job!", no emojis. Keep it under 40 words.
```

**Model:** `claude-haiku-4-5-20251001`  
**maxDuration:** 15 (no edge runtime)

---

### POST `/api/health/food/coach`
Today's Fuel summary OR a coach question. One route handles both.

**Body:**
```ts
{ date: string; question?: string; chip_label?: string }
```
- `question` absent → generate Today's Fuel summary
- `question` present → user is asking a specific question

**Auth:** standard.

**Logic:**
1. Load today's meals (item_name, calories, protein_g, carbs_g, fat_g, coach_feedback).
2. Load health profile (daily_calorie_target, daily_protein_target_g, daily_carbs_target_g).
3. Load today's workout from `daily_checkins.evening_actual_training` (bool) + `evening_actual_training` and `workouts` table — if a workout was completed today, include exercise count + total volume.
4. Compute totals (calories, protein, carbs eaten so far).

**If summary (no question):**
- Delete existing summary row for this date (`is_summary = true`).
- Insert `role: 'assistant', is_summary: true` row as streaming accumulates.
- System prompt: `"You are a blunt, smart nutrition coach. Based on what the user has eaten today and their targets, give a 2-3 sentence honest read of their fuel state. Include what's going well, what to watch, and one concrete suggestion for the rest of the day. No filler. Under 60 words."`

**If question:**
- Insert `role: 'user', content: question, chip_label: chip_label ?? null`.
- Stream assistant response using full context.
- Insert `role: 'assistant', content: accumulated` when done.
- System prompt: `"You are a direct, no-BS nutrition coach. The user is asking about their food today. Answer specifically using their actual numbers. Under 50 words."`

**Model:** `claude-haiku-4-5-20251001`  
**maxDuration:** 30  
**Return:** `ReadableStream`

---

### GET `/api/health/food/coach?date=YYYY-MM-DD`
Returns all messages for the day.

**Response:** `food_coach_messages[]` ordered by `created_at asc`.

---

## TanStack Query

In `src/features/food/queries.ts`:

```ts
export function useFoodCoachMessages(date: string) {
  return useQuery({
    queryKey: ['food-coach', date],
    queryFn: async () => {
      const res = await fetch(`/api/health/food/coach?date=${date}`)
      if (!res.ok) throw new Error('Failed to load coach messages')
      return res.json() as Promise<FoodCoachMessage[]>
    },
  })
}
```

In `src/features/food/mutations.ts`:

```ts
// Auto-called after useLogFood succeeds
export function useMealCoach()    // POST /api/health/food/[id]/coach, streams, local state

// Manual trigger for Today's Fuel and Ask your coach
export function useFoodCoach()    // POST /api/health/food/coach, streams, invalidates ['food-coach', date]
```

---

## Types

In `src/features/food/types.ts`, add:

```ts
export interface FoodCoachMessage {
  id: string
  user_id: string
  date: string
  role: 'user' | 'assistant'
  content: string
  chip_label: string | null
  is_summary: boolean
  created_at: string
}
```

Also add `coach_feedback: string | null` to `FoodLog`.

---

## UI: Per-meal blurb

**Trigger:** fires when `refine_status` transitions to `'done'` — not on initial log. This ensures the feedback is always based on the final, refined macros.

**For photo meals (`PhotoMealCard`):**
- When the refine flow finalizes (either `done` set from initial POST because no question was generated, or after the final `refine` route call returns `status: 'final'`), call `POST /api/health/food/[id]/coach` and stream into local `coachFeedback` state.
- On reload: `meal.coach_feedback` from DB is the source of truth (initialize `coachFeedback` from it).
- If `meal.refine_status === 'done'` on mount and `meal.coach_feedback` is null (shouldn't happen for new meals, but possible for old ones), show nothing — don't auto-trigger retroactively.

**For non-photo meal rows (compact rows in FoodSection):**
- Non-photo meals (text, drink, barcode) don't have a refine flow, so they ARE triggered immediately on `logFood.onSuccess` from FoodSection.
- FoodSection maintains `mealFeedback: Record<string, string>` state, streams feedback in after log, passes down as prop to each compact row.
- On reload: `meal.coach_feedback` from DB.

**Render (shared pattern for both):**
```tsx
{coachFeedback && (
  <p className="text-xs italic text-zinc-400 leading-relaxed mt-1.5 border-t border-white/[0.06] pt-1.5">
    {coachFeedback}
  </p>
)}
```

---

## UI: FoodCoachSection Component

New file: `src/app/health/FoodCoachSection.tsx`

```
┌────────────────────────────────────────┐
│  TODAY'S FUEL                          │
│  ┌──────────────────────────────────┐  │
│  │ [assistant text or placeholder]  │  │
│  └──────────────────────────────────┘  │
│  [Generate ↻]  (or [↻ Refresh])        │
│                                        │
│  ASK YOUR COACH                        │
│  [enough protein today?]               │
│  [what should I eat tonight?]          │
│  [how am I tracking?]                  │
│  [how many more calories?]             │
│                                        │
│  ┌──────────────────────────────┐ [↑] │
│  │ Ask your coach…              │     │
│  └──────────────────────────────┘     │
│                                        │
│  — thread —                           │
│  You: enough protein today?           │
│  Coach: You're at 89g of your 150g…   │
│  You: what should I eat tonight?      │
│  Coach: You need ~60g more protein…   │
└────────────────────────────────────────┘
```

**Preset chips (hardcoded):**
- "enough protein today?"
- "what should I eat tonight?"
- "how am I tracking?"
- "how many more calories?"

**Today's Fuel states:**
- `meals.length === 0` → italic zinc-500 "Log a meal and I will take a look."
- `meals.length > 0 && !summaryMessage && !generating` → button "Get today's fuel breakdown →"
- `generating` → streaming text
- `summaryMessage` → text + small "↻" icon button to regenerate

**Thread display:**
- `useFoodCoachMessages(today)` filtered to `!is_summary`.
- User messages: right-aligned, white text, small.
- Assistant messages: left-aligned, zinc-300, slightly larger, streams live for the current response.
- No avatars, no timestamps — keep it tight.

**Streaming pattern:**
```ts
const [streamText, setStreamText] = useState('')
const [streaming, setStreaming] = useState(false)

async function askCoach(question: string, chipLabel?: string) {
  setStreaming(true)
  setStreamText('')
  const res = await fetch('/api/health/food/coach', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: today, question, chip_label: chipLabel ?? null }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    setStreamText(prev => prev + decoder.decode(value))
  }
  setStreaming(false)
  qc.invalidateQueries({ queryKey: ['food-coach', today] })
}
```

---

## Positioning in FoodSection

After `{/* Meal list */}` block and before `{/* View history */}`:

```tsx
{(meals ?? []).length > 0 && (
  <FoodCoachSection
    today={today}
    meals={meals ?? []}
    profile={profile}
  />
)}
```

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `supabase/migrations/20260612000001_food_coach.sql` | CREATE |
| `src/app/api/health/food/[id]/coach/route.ts` | CREATE |
| `src/app/api/health/food/coach/route.ts` | CREATE |
| `src/features/food/types.ts` | ADD `FoodCoachMessage`, `coach_feedback` to `FoodLog` |
| `src/features/food/queries.ts` | ADD `useFoodCoachMessages` |
| `src/features/food/mutations.ts` | ADD `useFoodCoach` |
| `src/app/health/FoodCoachSection.tsx` | CREATE |
| `src/app/health/HealthClient.tsx` | ADD `FoodCoachSection` to FoodSection, add streaming meal feedback state, pass to meal rows |

---

## Notes / Gotchas

- Per-meal coach for photo meals fires in `PhotoMealCard` when refine resolves to `done` — never during the refine Q&A flow. For non-photo meals (text/drink/barcode), FoodSection fires it immediately on log success.
- Today's Fuel summary: re-generated on demand (not auto). User controls timing so they don't burn tokens after every individual meal.
- Workout context: pull from `workouts` joined `exercises` for today's date. If `completed_at` is set today, include exercise names + set count in the coach prompt.
- All streaming routes: `export const runtime = 'nodejs'` explicitly (no edge).
- All coach routes use `claude-haiku-4-5-20251001` — per-meal blurb, daily summary, and ask coach.
