# Progression Engine

`src/features/gym/progression.ts` — decides whether the next session goes up in
weight, holds, or backs off. Pure TypeScript, no React, no Supabase, no `await`.
Tested in `src/features/gym/progression.test.ts` (`npm test`).

## Why it was rewritten

The old rule lived inline in `GymClient.tsx` and read **only the last set** of
the last session, comparing its rep count to `rep_min`. Two things break:

1. **Within-session fatigue reads as regression.** `120 × 9, 8, 7` is a good
   session — reps fade across sets because you're tired, not because you're
   weaker. The old rule saw `7 < 8` and prescribed a weight drop, which is the
   opposite of the right call.
2. **It never read the weight column.** `115 × 12` in April and `145 × 7` in
   June averages to "9.5 reps → hold". In reality estimated 1RM went 161 → 179,
   an 11% gain. Reps alone cannot answer the question, so no amount of
   threshold tuning fixes it.

## Shape

Two stages, split so the deciding half takes numbers and returns a string:

| Stage | Function | In → Out |
| --- | --- | --- |
| Prep | `buildSessionHistory` | `GymLog[]` → `SessionPerf[]` (one row per training day) |
| Decide | `decideProgression` | `SessionPerf[]` + `ProgressionSpec` → `Prescription` |

`prescribe(logs, exercise, units, ctx)` runs both. `GymClient` calls the halves
separately so it can reuse the history for the live set cue.

**`perf`** is the trend metric on every session: estimated 1RM via Epley
(`weight × (1 + reps / 30)`), or best reps for bodyweight lifts where the load
never changes. It is the only number comparable across different weights.

**Working weight** is the load carrying the most sets, ties going heavier — so
one heavy single doesn't outrank three working sets.

Swapped sets (`performed_exercise != null`, a travel-day substitute) are dropped
before anything else. A dumbbell press must never drive the barbell press.

## Rep zones

Zones tile the number line with no gaps and no overlaps, written as an ordered
cascade rather than three independent comparisons:

```
avg working reps >= rep_max   → ceiling
avg working reps >= rep_min   → in
otherwise                     → below
```

Ranges written the friendly way (`x < 8`, `8 < x < 13`, `x > 12`) leave 8
matching nothing and 12 matching two rules. A test asserts every value from 0 to
30 lands in exactly one zone.

## Decision cascade

Ordered. Each branch is a guard the later ones may assume is false.

| # | Branch | Fires when | Action |
| --- | --- | --- | --- |
| 1 | **Layoff** | 21+ days since last session | `REPEAT` at 90% (80% past 45 days) |
| 2 | **Thin data** | exactly one session logged | zone rule, `low` confidence, never deload |
| 3 | **Ceiling** | avg reps at or above `rep_max` | `INCREASE` one step, two if every set buried the ceiling |
| 4 | **Grace after a jump** | working weight rose vs last session | `REPEAT` — reps drop by design after a jump |
| 4b | **Overshoot** | top set landed 2+ reps under `rep_min` after a jump | `DROP` to the weight the demonstrated e1RM puts `rep_min` at |
| 5 | **Stall** | 4+ sessions at the weight, 4+ without a best, 3+ under the floor, not rising | `DELOAD` to 90% |
| 6 | **Regression** | e1RM down 5%+ and the previous session was also down | `DROP` one step |
| 7 | **In range** | zone `in` | `HOLD` — "keep pushing" if rising, "change a variable" if flat 3+ sessions |
| 8 | **Below, top set OK** | top set still cleared `rep_min` | `HOLD` — recovery problem, rest longer between sets |
| 8b | **Below, still trending up** | e1RM flat or rising, best is recent | `REPEAT` |
| 8c | **Below, 3 sessions running** | top set missed `rep_min` 3 sessions in a row | `DROP` one step |
| 8d | fallthrough | — | `REPEAT` |

Two guards do most of the work the old rule got wrong:

- **Branch 4** stops the yo-yo. After an `INCREASE`, reps *always* fall below
  `rep_min` — that is the cost of the load. The old rule immediately dropped the
  weight back, so a lifter could never leave one weight.
- **Branch 8** uses the **top set**, not the average, to decide whether the
  weight is genuinely too heavy. `sessionsBelowFloor` counts consecutive
  sessions whose *top* set missed the floor, so a single tired third set never
  triggers anything.

`OVERREACH_PCT` is -12%, not -5%, because Epley overestimates e1RM at high rep
counts: a 12-rep set compared against a 7-rep set shows a paper drop that isn't
real. Overreach is judged primarily on how far the reps landed outside the
range, with the e1RM drop only as corroboration.

## Output

`Prescription` carries the reasoning, not just the verdict:

- `action` / `nextWeight` — unchanged from before, for existing call sites
- `headline` — the call in a phrase ("Keep pushing at 120lbs")
- `detail[]` — what happened → why it reads that way → what to do
- `target` — concrete weight × reps for the next session
- `confidence` — `high` / `medium` / `low`, rendered as three pips so a
  one-session call never looks like certainty
- `flags[]` — `layoff`, `new-weight`, `stalled`, `regression`, `new-best`,
  `fatigue-high`, `readiness-low`, `jump-too-big`, …
- `signals` / `trend` — the raw numbers the call came from, shown as chips under
  the card so it is not a black box

## Optional context

`decideProgression(history, spec, { readiness })` softens an earned weight jump
when Oura readiness is under 60: hold today, take the PR on a rested day. Purely
optional — the engine stays a pure function of its arguments.

## Live set cue

`nextSetGuidance(todaySets, history, spec, rx)` compares set N of today against
set N of the last session **at the same weight**, so the target moves with you
mid-workout instead of being one fixed number: `Set 3 · beat 7 from 08/02`.

## AI surfaces

`src/lib/gym/progressionBriefing.ts` runs the engine per exercise server-side
and injects a compact briefing into the Mentor's context, so the chat and the
Gym tab can't give conflicting calls on the same lift.
