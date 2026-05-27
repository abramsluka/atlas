# Gym History Redesign

Rework the Today's Workout and Past Workouts sections in GymClient.tsx for clarity and collapsibility.

---

## What changes

### 1. Today's Workout → collapsible, shows individual sets

**Currently:** Always expanded, shows one row per exercise with a summary ("3 sets · top 160lbs · 6,720lbs total").

**New behaviour:**
- Section header is a tappable collapse toggle (same chevron pattern as Past Workouts)
- Defaults to **expanded**
- When expanded, shows each exercise as a sub-header, with **every set listed individually** underneath:

```
TODAY'S WORKOUT  —  TUE, MAY 26          ▲

  Bench Press
    155 lbs × 13
    160 lbs × 14

  Incline DB Press
    60 lbs × 12
    65 lbs × 10
    65 lbs × 8

  3 exercises · 7 sets · 12,345 lbs total
```

- Bodyweight exercises: show `BW × 12` (no lbs)
- RPE: if logged, show it inline — `155 lbs × 13  @8`
- Total summary row at the bottom of the card (sets count + volume)

---

### 2. Past Workouts → each day expanded in its own box with individual sets

**Currently:** Collapsed behind a single toggle, then all days listed compactly (one row per exercise, summary only).

**New behaviour:**
- Top-level "Past workouts (N)" toggle unchanged — still collapses/expands the whole block
- When expanded, each **day** gets its **own rounded card** separated by a gap
- Inside each day card:
  - Header: date label + total sets + total volume
  - Each exercise as a sub-header
  - Every set listed individually (same format as Today's Workout above)

```
Past workouts  3                          ▼

  ┌─────────────────────────────────────┐
  │ MON, MAY 25                         │
  │ 6 sets · 9,800 lbs                  │
  │                                     │
  │ Bench Press                         │
  │   150 lbs × 12                      │
  │   155 lbs × 11                      │
  │                                     │
  │ Squat                               │
  │   185 lbs × 10                      │
  │   185 lbs × 10                      │
  └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐
  │ SAT, MAY 23                         │
  │ ...                                 │
  └─────────────────────────────────────┘
```

---

## Implementation notes (all changes in `src/app/gym/GymClient.tsx`)

### State to add
```ts
const [todayExpanded, setTodayExpanded] = useState(true)
```
`pastExpanded` already exists.

### Today's Workout section

Replace the current exercise row (`{sets.length} sets · top ...`) with a mapped list of individual set rows. The set data is already available in `todayAllLogs` — filter by `exercise_id`, sort by `logged_at`.

```tsx
{sets
  .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
  .map((set, i) => (
    <div key={set.id} className="flex items-center justify-between px-5 py-1.5 text-sm">
      <span className="text-white/30 tabular-nums w-5">{i + 1}</span>
      <span className="flex-1 text-white/70 tabular-nums">
        {ex?.bodyweight ? `BW` : `${set.weight} ${config.units}`}
        {' '}×{' '}
        {set.reps}
        {set.rpe ? <span className="text-white/30 ml-2">@{set.rpe}</span> : null}
      </span>
    </div>
  ))
}
```

### Past Workouts section

Change the inner content from the compact single-row-per-exercise layout to the per-day card layout with individual sets. Each day card is `rounded-xl bg-white/3 border border-white/6 p-4 space-y-3`.

Within each day, map exercises → map sets, same format as above.

### Set ordering

Sort sets within each exercise by `logged_at` ascending so they appear in log order.

### Data already available

All `allLogs` already include `weight`, `reps`, `rpe`, `exercise_id`, `logged_at`. No new API calls needed.

---

## Build order

1. Add `todayExpanded` state
2. Wrap Today's Workout header in a collapse toggle button
3. Replace exercise summary rows with individual set rows (when expanded)
4. In Past Workouts expanded view: replace compact rows with per-day cards + individual sets
5. Check that bodyweight exercises render correctly (`BW × N`)
6. Smoke test: log a few sets, verify they appear in correct order
