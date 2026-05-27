# Gym Page — Today's Workout & Timezone Fix

Two bugs to fix. Do them both in one pass.

---

## Bug 1 — Date is one day ahead (timezone)

The server generates `today` using `format(new Date(), 'yyyy-MM-dd')` which runs in UTC.
After 5pm PST the server thinks it's the next day.

The client's `todayKey()` and `todayDateLabel()` also use `new Date()` without timezone handling —
these run in the browser (correct local time) but need to stay in sync with the server `today` prop.

### Fix

**`src/app/gym/page.tsx`** — generate `today` in PST:

```ts
import { formatInTimeZone } from 'date-fns-tz'
// replace:
const today = format(new Date(), 'yyyy-MM-dd')
// with:
const today = formatInTimeZone(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd')
```

**`src/app/gym/GymClient.tsx`** — `todayKey()` and `todayDateLabel()` should match:

```ts
const TZ = 'America/Los_Angeles'

function toZonedDate(): Date {
  // offset the UTC clock by LA's current UTC offset
  const now = new Date()
  const laStr = now.toLocaleString('en-US', { timeZone: TZ })
  return new Date(laStr)
}

function todayKey(): string {
  const d = toZonedDate()
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function todayDateLabel(): string {
  const d = toZonedDate()
  return DOWS[d.getDay()] + ', ' + MONS[d.getMonth()] + ' ' + d.getDate()
}
```

Check if `date-fns-tz` is already installed (`grep date-fns-tz package.json`). If not, install it:
```
npm install date-fns-tz
```

---

## Bug 2 — "Finish Workout" button lost / nested button bug

### Problem

The Today's Workout section header is a `<button>` (collapse toggle) that contains
another `<button>` ("Mark done"). **Nested buttons are invalid HTML** — React hydration
errors, unpredictable click behavior, and the inner button may silently vanish.

### Target layout

```
┌─────────────────────────────────────────────────┐
│ TODAY'S WORKOUT  —  TUE, MAY 26          ▲      │  ← tap anywhere to collapse
│ 7 sets · 12,345 lbs                             │
├─────────────────────────────────────────────────┤
│  Bench Press                                    │
│    1  155 lbs × 13                              │
│    2  160 lbs × 14                              │
│                                                 │
│  Incline DB Press                               │
│    1  60 lbs × 12                               │
├─────────────────────────────────────────────────┤
│          [ ✓  Finish Workout ]                  │  ← always visible, outside collapse
└─────────────────────────────────────────────────┘
```

- "Finish Workout" button is **always visible** (not inside the collapsible area)
- Tapping it toggles `todayDone` (the existing state) — visual feedback only for now
  (gym module doesn't have a DB-level "workout complete" concept; this is a signal to self)
- When `todayDone === true`, button reads "✓ Done" with green styling
- The collapse toggle is the card header row (use `<div role="button">` not `<button>` to avoid nesting issues)

### Fix in `src/app/gym/GymClient.tsx`

Replace the entire Today's Workout `<section>` block (currently lines ~875–939) with:

```tsx
{/* ── Today's Workout ───────────────────────────────── */}
{todayAllLogs.length > 0 && (
  <section>
    <div className="rounded-2xl bg-white/5 border border-white/8 overflow-hidden">
      {/* Header row — collapse toggle (div, not button, to avoid nesting) */}
      <div
        role="button"
        onClick={() => setTodayExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer active:opacity-70"
      >
        <div>
          <p className="text-xs text-white/40 uppercase tracking-widest font-semibold mb-0.5">
            Today's Workout — {todayDateLabel()}
          </p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums">{todayAllLogs.length}</span>
            <span className="text-sm text-white/40">sets</span>
            <span className="text-white/20">·</span>
            <span className="text-sm text-white/60">{Math.round(todayVolume).toLocaleString()} {config.units}</span>
          </div>
        </div>
        <span className="text-white/30 text-xs ml-4 shrink-0">{todayExpanded ? '▲' : '▼'}</span>
      </div>

      {/* Individual sets per exercise (collapsible) */}
      {todayExpanded && (
        <div className="border-t border-white/6">
          {todayExIds.map(exId => {
            const ex = exercises.find(e => e.id === exId)
            const sets = todayAllLogs
              .filter(l => l.exercise_id === exId)
              .sort((a, b) => a.logged_at.localeCompare(b.logged_at))
            return (
              <div key={exId} className="px-5 py-3 border-b border-white/5 last:border-b-0">
                <p className="text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                  {ex?.name ?? 'Exercise'}
                </p>
                <div className="space-y-1">
                  {sets.map((set, i) => (
                    <div key={set.id} className="flex items-center gap-3 text-sm">
                      <span className="w-4 text-white/20 tabular-nums text-xs">{i + 1}</span>
                      <span className="text-white/80 tabular-nums">
                        {ex?.bodyweight ? 'BW' : `${set.weight} ${config.units}`}
                        {' × '}
                        {set.reps}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Finish Workout button — always visible, outside collapse */}
      <div className="px-5 py-4 border-t border-white/6">
        <button
          onClick={() => setTodayDone(d => !d)}
          className={`w-full rounded-xl py-3.5 text-sm font-bold transition-all active:scale-[0.98] ${
            todayDone
              ? 'bg-green-500/20 border border-green-500/40 text-green-400'
              : 'bg-white text-black'
          }`}
        >
          {todayDone ? '✓ Done for today' : 'Finish Workout'}
        </button>
      </div>
    </div>
  </section>
)}
```

---

## Files to change

1. `src/app/gym/page.tsx` — timezone fix (1 line)
2. `src/app/gym/GymClient.tsx` — `todayKey()`, `todayDateLabel()`, Today's Workout section

## Verify

- Open `/gym` at a time well past 5pm PST — date should still read today, not tomorrow
- Log a set — Today's Workout card appears with correct date
- Collapse/expand works (tap header row)
- "Finish Workout" button is always visible below the set list
- Past workouts shows only previous days, not today

## Notes

- `todayDone` is already in state, no new state needed
- No DB changes — gym module doesn't have a workout-level "completed" concept
- If you want to persist `todayDone` across page refreshes later, store it in localStorage keyed by date
