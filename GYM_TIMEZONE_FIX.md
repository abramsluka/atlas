# Gym Page — Timezone Bug Diagnosis & Fix

## Root Cause

`gym_logs.logged_at` is `timestamptz` stored as UTC. When Luka logs a set at, say,
8pm PST, Postgres stores it as `2026-05-27T03:30:00+00:00`.

The code extracts the date with `.slice(0, 10)` — that returns `'2026-05-27'` (the UTC date).

After our last fix, `today` is now correctly `'2026-05-26'` (PST). But the log dates
are still extracted in UTC. So `'2026-05-27' !== '2026-05-26'` — every single log
is treated as "not today" and lands in Past Workouts, labeled Wednesday May 27.

The Today's Workout card never appears because `todayAllLogs` is always empty.

---

## What needs to change

**One helper function** converts a UTC `logged_at` string to a PST date key:

```ts
function logDatePST(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  // returns 'YYYY-MM-DD' in PST — 'en-CA' locale gives ISO format
}
```

Replace every occurrence of `l.logged_at.slice(0, 10)` that's used for **date grouping**
with `logDatePST(l.logged_at)`.

---

## Files and exact lines to change

### `src/app/gym/GymClient.tsx`

**Add helper** near the top with the other helpers (after `todayDateLabel`):
```ts
function logDatePST(utcStr: string): string {
  return new Date(utcStr).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}
```

**Replace these derived values** (currently around lines 505–512):
```ts
// BEFORE
const todayAllLogs = allLogs.filter(l => l.logged_at.slice(0, 10) === today)
const todayExIds = [...new Set(todayAllLogs.map(l => l.exercise_id))]
const todayVolume = todayAllLogs.reduce((s, l) => s + l.weight * l.reps, 0)

const pastDates = [...new Set(
  allLogs.filter(l => l.logged_at.slice(0, 10) !== today).map(l => l.logged_at.slice(0, 10))
)].sort((a, b) => b.localeCompare(a)).slice(0, 10)

// AFTER
const todayAllLogs = allLogs.filter(l => logDatePST(l.logged_at) === today)
const todayExIds = [...new Set(todayAllLogs.map(l => l.exercise_id))]
const todayVolume = todayAllLogs.reduce((s, l) => s + l.weight * l.reps, 0)

const pastDates = [...new Set(
  allLogs.filter(l => logDatePST(l.logged_at) !== today).map(l => logDatePST(l.logged_at))
)].sort((a, b) => b.localeCompare(a)).slice(0, 10)
```

**In the exercise detail panel** — "Today" section filter (added in the last session):
```ts
// BEFORE
{exLogs.filter(l => l.logged_at.slice(0, 10) === today).length > 0 && (
// ...
{exLogs.filter(l => l.logged_at.slice(0, 10) === today).map((log, i) => (

// AFTER
{exLogs.filter(l => logDatePST(l.logged_at) === today).length > 0 && (
// ...
{exLogs.filter(l => logDatePST(l.logged_at) === today).map((log, i) => (
```

**In `exLogs` derivation** (around line 340) — `exLogs` is used for the sparkline and
session count, which should include all dates, so no change there. But `sessionDates`
derived from `exLogs` needs PST dates too:

Search for `sessionDates` derivation — if it uses `.slice(0, 10)` replace with `logDatePST`.

**In Past Workouts day label** — the `date` value passed to the label builder is now
correctly a PST date key, so no change needed there. Double-check the label building
still does `date.split('-').map(Number)` and constructs the label from that — that's fine.

### `src/app/workouts/GymClient.tsx` (old workout logger)

Same issue exists in the old logger. Apply the same helper and replace all
`.logged_at.slice(0, 10)` comparisons used for date grouping.

Search for: `logged_at.slice(0, 10)`
Replace each instance that compares to `today` or groups by date.

---

## Verify after fix

1. Open `/gym` — date in sticky header should read Tuesday, May 26 (PST)
2. Log a set — Today's Workout card should appear immediately
3. Past Workouts should show previous days (May 25, May 23, etc.) — NOT today
4. Exercise detail "Today" section should show only today's sets with delete buttons
5. After 5pm PST, the date should still correctly be today (not roll to tomorrow)

---

## Notes

- `en-CA` locale is used for `toLocaleDateString` because it naturally produces
  `YYYY-MM-DD` format, matching the `today` string format from `formatInTimeZone`.
- Do NOT change `logged_at.slice(0, 10)` uses that are for display purposes only
  (e.g. building a sparkline from absolute timestamps — those can stay UTC-sliced
  since they're used for relative comparisons, not date-keyed grouping).
- The DB schema does not need to change. `timestamptz` is correct; we just need to
  interpret it in the right timezone on read.
