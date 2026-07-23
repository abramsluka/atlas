# Spec: Longitudinal Pattern Recognition for Atlas Mentor

## Overview

This feature builds a statistical model of Luka's behaviour over time from existing Supabase data, expressed as plain computed facts. These facts get injected into the mentor's system prompt on every chat call, so Atlas can make specific, data-backed observations ("your Wednesday training consistency is 40%") instead of just summarising the last week.

No ML libraries. No new tables. Pure TypeScript math computed at chat time from existing data.

---

## Stack Context

- **Next.js App Router** (v16.2.6) + TypeScript
- **Supabase** with service role client (`createServiceClient()`) for all DB reads — RLS bypassed
- Mentor chat lives in `src/app/api/mentor/chat/route.ts`
- The system prompt is assembled in Step 4 of that route using a `parts: string[]` array, then joined with `\n\n`
- Pattern output is a plain string that gets pushed onto `parts`

---

## Database Tables In Scope

### `gym_logs`
- `id` (uuid), `user_id` (uuid), `logged_at` (timestamptz), `weight` (float, nullable), `reps` (int, nullable), `exercise_id` (uuid)
- Join: `gym_exercises(name)` — `gym_exercises.name` is the exercise name string

### `gym_exercises`
- `id` (uuid), `user_id` (uuid), `name` (text), `order_index` (int), `step` (float, nullable), `created_at` (timestamptz)

### `wearable_data`
- `id` (uuid), `user_id` (uuid), `date` (date, YYYY-MM-DD), `provider` ('oura' | 'whoop'), `data` (jsonb)
- For Oura, `data` shape includes: `readiness.score`, `readiness.temperature_deviation`, `sleep.score`, `sleep.average_hrv`, `sleep.resting_heart_rate`, `sleep.total_sleep_duration` (seconds), `activity.steps`, `activity.active_calories`

### `journal_entries`
- `id` (uuid), `user_id` (uuid), `date` (date, YYYY-MM-DD), `mood` (int 1–5, nullable), `body` (text), `created_at` (timestamptz)

### `body_weights`
- `id` (uuid), `user_id` (uuid), `date_key` (date, YYYY-MM-DD), `weight` (float, lbs), `created_at` (timestamptz)

### `food_logs`
- `id` (uuid), `user_id` (uuid), `date` (date, YYYY-MM-DD), `calories` (float, nullable), `protein_g` (float, nullable)

### `water_logs`
- `id` (uuid), `user_id` (uuid), `date` (date, YYYY-MM-DD), `amount_oz` (float)

### `daily_checkins`
- `id` (uuid), `user_id` (uuid), `date` (date, YYYY-MM-DD), `morning_planned_training` (text, nullable), `evening_actual_training` (text, nullable)

---

## File to Create

**`src/lib/computePatterns.ts`**

This module exports one async function:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export async function computePatterns(
  db: SupabaseClient,
  userId: string,
  tz: string,        // IANA timezone string, e.g. "America/New_York"
  today: string,     // YYYY-MM-DD in user's local timezone
): Promise<string>
```

Returns a formatted string (may be empty if there isn't enough data). The caller pushes it onto the mentor system prompt `parts` array. If the returned string is empty, don't push anything.

---

## Data Fetching Inside `computePatterns`

Fetch wider windows than the main mentor route uses. All queries use `db` (service role, RLS bypassed).

```ts
const ninetyDaysAgo = formatInTimeZone(subDays(new Date(), 90), tz, 'yyyy-MM-dd')
const sixtyDaysAgo  = formatInTimeZone(subDays(new Date(), 60), tz, 'yyyy-MM-dd')
const thirtyDaysAgo = formatInTimeZone(subDays(new Date(), 30), tz, 'yyyy-MM-dd')

const [gymLogs, exercises, wearable, moods, weights, foodDates, waterDates, checkins] = await Promise.all([
  db.from('gym_logs')
    .select('logged_at, exercise_id, weight, reps, gym_exercises(name)')
    .eq('user_id', userId)
    .gte('logged_at', new Date(Date.now() - 90 * 86400000).toISOString())
    .order('logged_at', { ascending: true }),

  db.from('gym_exercises')
    .select('id, name, created_at')
    .eq('user_id', userId),

  db.from('wearable_data')
    .select('date, provider, data')
    .eq('user_id', userId)
    .eq('provider', 'oura')
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: true }),

  db.from('journal_entries')
    .select('date, mood')
    .eq('user_id', userId)
    .not('mood', 'is', null)
    .gte('date', sixtyDaysAgo)
    .order('date', { ascending: true }),

  db.from('body_weights')
    .select('date_key, weight')
    .eq('user_id', userId)
    .gte('date_key', sixtyDaysAgo)
    .order('date_key', { ascending: true }),

  db.from('food_logs')
    .select('date')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo),

  db.from('water_logs')
    .select('date, amount_oz')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo),

  db.from('daily_checkins')
    .select('date, morning_planned_training, evening_actual_training')
    .eq('user_id', userId)
    .gte('date', thirtyDaysAgo),
])
```

Treat null/error results as empty arrays: `gymLogs.data ?? []` etc.

---

## Patterns to Compute

Build a `findings: string[]` array. Each entry is one concrete finding sentence. At the end, if `findings.length > 0`, return the block. If `< 3` findings exist (not enough data to say anything meaningful), return `''`.

### 1. Training Consistency by Day of Week

**Minimum data:** ≥ 4 weeks of gym_logs.

**Method:**
1. Build a set of training days: for each `gym_logs` row, get the local date using `new Date(logged_at).toLocaleDateString('en-CA', { timeZone: tz })`. Deduplicate (a day with multiple sets = one training day).
2. Build a set of all days in the 90-day window: iterate from 90 days ago to today.
3. For each day of week (0=Sun, 1=Mon … 6=Sat), count: `trainingDays` / `totalDays` × 100. Only include days that appeared ≥ 4 times in the window.
4. Find the highest and lowest consistency day of week (among those with ≥ 4 appearances).
5. If the lowest day's consistency is ≤ 40%, emit a finding. If the highest is ≥ 75%, emit a finding.

```
"Your most consistent training day is Monday (78% of Mondays). You skip Wednesdays most often — only 23% consistency."
```

Day names: `['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']`

### 2. Training Frequency Trend

**Minimum data:** ≥ 6 weeks of gym_logs.

**Method:**
1. Group training days into ISO weeks (`getISOWeek` from `date-fns`, or manual: `Math.floor(daysSinceEpoch / 7)`).
2. Count sessions per week for the 12 most recent complete weeks.
3. Compare the average of the first 6 weeks vs the last 6 weeks.
4. If the change is ≥ 1 session/week difference, emit a finding.

```
"Your training frequency has dropped: 4.2 sessions/week 6 weeks ago vs 2.3 sessions/week recently."
"Your training consistency is improving: up from 2.5 to 4.0 sessions/week over the past 6 weeks."
```

If last 2 weeks both have 0 sessions, emit a specific finding about the gap.

### 3. Most Skipped Exercises

**Minimum data:** `gym_exercises` has ≥ 3 exercises. At least 28 days of gym_logs history.

**Method:**
1. For each exercise in `gym_exercises`, compute the last `logged_at` date from `gym_logs` matching `exercise_id`.
2. Calculate days since last logged.
3. If an exercise has never been logged at all (no rows in gym_logs for that exercise_id), days = 90+.
4. Emit a finding for exercises with days ≥ 21 (not logged in 3+ weeks), capped at 2 exercises.

```
"You haven't logged Overhead Press in 24 days. It's still in your program."
"Deadlift hasn't been logged in 31 days."
```

### 4. HRV: Training Days vs Rest Days

**Minimum data:** ≥ 14 days of Oura data, ≥ 8 training days in that window.

**Method:**
1. Build the set of local training dates from gym_logs (same as pattern 1, but for the 60-day window).
2. For each Oura row, extract `data.sleep.average_hrv` (this is HRV from overnight sleep). The date on `wearable_data` is the *morning* the ring synced — so HRV on date D reflects the night of D-1 into D. This is already how Oura reports it; treat it as-is.
3. Split HRV values into two buckets: days where the wearable date IS a training day vs days where it is NOT.
4. Compute the mean for each bucket. Only emit if both buckets have ≥ 5 data points.
5. Emit if the difference is ≥ 4ms.

```
"Your HRV averages 58ms on rest days vs 49ms on training days — a 9ms suppression after hard sessions."
"Your HRV doesn't differ much between training and rest days (52ms vs 54ms) — good recovery."
```

If the difference is < 4ms, emit the positive version ("Your HRV holds steady...").

### 5. Sleep Score Variance

**Minimum data:** ≥ 21 days of Oura `sleep.score`.

**Method:**
1. Collect all non-null `sleep.score` values.
2. Compute mean and standard deviation: `σ = sqrt( Σ(x - μ)² / n )`.
3. Classify: σ < 5 = "very consistent", 5–9 = "moderate", ≥ 10 = "high variance".
4. Also compute the 14-day trend: average of first 7 in window vs last 7. If the shift is ≥ 5 points, note the direction.
5. Emit one finding that combines variance + trend if relevant.

```
"Your sleep score has high variance (σ=13, range 52–88). Inconsistent sleep is probably your biggest recovery variable."
"Your sleep score has been trending up: 68 avg two weeks ago vs 74 avg this week."
```

### 6. Mood vs Training Correlation

**Minimum data:** ≥ 10 journal entries with mood scores, ≥ 10 training days in the same window.

**Method:**
1. Build training date set from gym_logs (60-day window).
2. For each mood entry with a non-null mood, classify the *following day* as a training day or not. (Training the day before → does mood go up?) Actually, use the simpler approach: split mood scores by whether the journal date itself is a training day or the day after a training day (within 24 hours).
   - Easier: split mood scores by whether the journal `date` is a training day.
3. Compute mean mood for training days vs non-training days.
4. Emit if the difference is ≥ 0.5 on the 1–5 scale.

```
"Your mood scores average 4.1 on days you train vs 3.3 on rest days — training is clearly lifting your baseline."
"Your mood doesn't correlate strongly with training days (3.6 vs 3.8)."
```

### 7. Body Weight Trend

**Minimum data:** ≥ 8 weight entries spanning ≥ 14 days.

**Method:**
1. Collect sorted `(date_key, weight)` pairs.
2. Compute a simple linear regression slope: 
   ```
   xs = [0, 1, 2, ...n-1]   (index positions, not actual dates — sufficient for trend)
   Actually: use actual day offsets from first date for accuracy
   x_i = daysBetween(firstDate, date_i)
   slope = (n * Σ(x_i * y_i) - Σx_i * Σy_i) / (n * Σ(x_i²) - (Σx_i)²)
   slope is in lbs/day — multiply by 7 to get lbs/week
   ```
3. Only emit if |slope| ≥ 0.1 lbs/week (below that is noise).
4. Round to 1 decimal.

```
"Your weight is trending up at +0.5 lbs/week over the past 6 weeks (182 → 185 lbs)."
"Your weight has been declining steadily: -0.8 lbs/week over the past month."
"Your weight is stable (< 0.1 lbs/week change)."
```

### 8. Calorie Tracking Consistency

**Minimum data:** 14+ days in the window (just need enough days to compute a rate).

**Method:**
1. Count distinct dates with at least one food log entry in the last 30 days.
2. Total days in window = min(30, days since account created — don't count future days).
3. Compute tracking rate = logged_days / total_days × 100.
4. Emit if rate < 60% (tracking is inconsistent) or if rate ≥ 85% (tracking is strong).

```
"You've been tracking food on only 9 of the last 30 days (30%). Gaps in tracking mean Atlas is working with incomplete nutrition data."
"Strong food tracking: 27/30 days logged this month."
```

### 9. Hydration Pattern

**Minimum data:** ≥ 7 water log entries.

**Method:**
1. Sum `amount_oz` per distinct date.
2. Compute average daily oz (total oz / distinct logged days).
3. Convert to liters: oz / 33.814.
4. Emit if average < 48oz (under-hydrated — below ~1.4L) or if the number of days with any log is < 50% of the 30-day window (inconsistent tracking/drinking).

```
"You average 42 oz/day of water — below the typical 64 oz target."
"Water tracking is sporadic: only 11 of the past 30 days have any logs."
```

---

## Output Format

Assemble all findings into a single block:

```ts
if (findings.length < 3) return ''

return `COMPUTED PATTERNS (statistical facts, not summaries):\n${findings.map(f => `• ${f}`).join('\n')}`
```

Each bullet should be one concrete sentence with specific numbers. No hedging language ("it seems", "you might"). These are facts.

Example full output:

```
COMPUTED PATTERNS (statistical facts, not summaries):
• Your most consistent training day is Monday (76% of Mondays). You skip Wednesdays most — only 28% consistency over 12 weeks.
• Training frequency has dropped: 4.0 sessions/week 6 weeks ago vs 2.2 sessions/week recently.
• You haven't logged Overhead Press in 26 days despite it being in your program.
• Your HRV averages 61ms on rest days vs 50ms on training days — 11ms suppression after hard sessions.
• Your sleep score has high variance (σ=14, range 49–84). Inconsistent sleep is your biggest recovery variable.
• Your mood scores average 4.2 on training days vs 3.4 on rest days.
• Your weight is trending up at +0.4 lbs/week over the past 5 weeks (178 → 180 lbs).
• You've tracked food on 11 of the last 30 days (37%). Atlas is working with incomplete nutrition data.
```

---

## Integration in `src/app/api/mentor/chat/route.ts`

In Step 3, add `computePatterns` to the parallel fetch. It has its own internal queries so it runs independently.

**Change in Step 3 (add to `Promise.all`):**
No — run it separately because it has its own internal `Promise.all` and mixing it in adds complexity. Call it in a separate `await` after the existing `Promise.all`, or add it as a top-level concurrent call using `Promise.all` with the pattern computation:

```ts
// After Step 2 (date windows), before Step 3:
const patternPromise = computePatterns(db, user.id, TZ, today)

// Existing Step 3 runs...
const [ gymLogData, ouraData, ... ] = await Promise.all([ ... ])

// Resolve patterns:
const patternText = await patternPromise
```

**Change in Step 4 (system prompt assembly), after the existing `parts.push` calls:**

```ts
if (patternText) {
  parts.push(patternText)
}

const systemPrompt = parts.join('\n\n')
```

---

## Helper Utilities Needed

Import from `date-fns` and `date-fns-tz` (both already installed):

```ts
import { subDays } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
```

**Local date from ISO timestamp:**
```ts
function localDate(isoString: string, tz: string): string {
  return new Date(isoString).toLocaleDateString('en-CA', { timeZone: tz })
  // Returns 'YYYY-MM-DD' format
}
```

**Day of week from YYYY-MM-DD:**
```ts
function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00').getDay() // 0=Sun
}
```

**Linear regression slope (lbs/day):**
```ts
function linearSlope(points: Array<{ x: number; y: number }>): number {
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (denom === 0) return 0
  return (n * sumXY - sumX * sumY) / denom
}
```

**Standard deviation:**
```ts
function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}
```

**Days between two YYYY-MM-DD strings:**
```ts
function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + 'T12:00:00').getTime() - new Date(a + 'T12:00:00').getTime()) / 86400000
  )
}
```

---

## Error Handling

Wrap the entire body of `computePatterns` in a try/catch. On any error, log it and return `''`. The mentor chat should never fail because pattern computation errored.

```ts
export async function computePatterns(...): Promise<string> {
  try {
    // ... all computation
  } catch (err) {
    console.error('[computePatterns] error:', err)
    return ''
  }
}
```

---

## TypeScript Types

Define locally in the file:

```ts
type GymLogRow = {
  logged_at: string
  exercise_id: string
  weight: number | null
  reps: number | null
  gym_exercises: { name: string } | null
}

type ExerciseRow = {
  id: string
  name: string
  created_at: string
}

type OuraRow = {
  date: string
  data: {
    sleep?: { score?: number; average_hrv?: number; total_sleep_duration?: number }
    readiness?: { score?: number }
    activity?: { steps?: number; active_calories?: number }
  }
}

type MoodRow = { date: string; mood: number }
type WeightRow = { date_key: string; weight: number }
type FoodRow = { date: string }
type WaterRow = { date: string; amount_oz: number }
type CheckinRow = {
  date: string
  morning_planned_training: string | null
  evening_actual_training: string | null
}
```

---

## What NOT to Do

- Do not import any ML or stats libraries (`ml-regression`, `simple-statistics`, `mathjs`, etc.)
- Do not store pattern results in Supabase — recompute on each chat call
- Do not emit a finding if the minimum data threshold isn't met — silence is better than a wrong claim
- Do not use `new Date(dateString)` without appending `T12:00:00` for date-only strings — timezone parsing bugs
- Do not add a new API route or UI for this — it's purely a system prompt injection in the existing mentor chat route
- Do not change any other mentor files besides `src/app/api/mentor/chat/route.ts`

---

## Files to Create / Modify

| File | Action |
|------|--------|
| `src/lib/computePatterns.ts` | **Create** — all pattern logic lives here |
| `src/app/api/mentor/chat/route.ts` | **Modify** — add `patternPromise` call before Step 3, inject result into `parts` in Step 4 |

No migrations, no new tables, no UI changes.
