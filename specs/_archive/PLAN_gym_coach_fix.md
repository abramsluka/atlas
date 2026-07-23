# Plan: Fix Gym Coach Crash (evening_actual_training.trim TypeError)

## Root Cause

`daily_checkins.evening_actual_training` is a **boolean** column in Postgres, not text.
The gym coach route treats it as a string and calls `.trim()` on it, crashing with:

```
TypeError: e.evening_actual_training.trim is not a function
```

The companion text field is `evening_reflection` (text, nullable) — that's what should be
trimmed/displayed. The boolean just tells you *whether* they trained.

## Files to Change

**`src/app/api/gym/coach/route.ts`** — two places:

### Fix 1 — checkinTrainingDays set (line ~58)

Current (wrong):
```typescript
const checkinTrainingDays = new Set(
  checkins
    .filter(c => c.evening_actual_training && c.evening_actual_training.trim())
    .map(c => c.date)
)
```

Fix:
```typescript
const checkinTrainingDays = new Set(
  checkins
    .filter(c => c.evening_actual_training === true)
    .map(c => c.date)
)
```

### Fix 2 — recent activity loop (line ~86)

Current (wrong):
```typescript
const evening = checkin?.evening_actual_training?.trim()
```

The variable `evening` is used in the display strings below it
(`${label}: lifted + ${evening}`, `${label}: ${evening}`). It needs
to be a string or null. The boolean says they trained; `evening_reflection`
is the description.

Fix:
```typescript
const evening = checkin?.evening_reflection?.trim() || null
// evening_actual_training (bool) is already captured via checkinTrainingDays / gymDays
```

Then the block that builds `recentActivity` needs to also account for the case where
`evening_actual_training` is true but `evening_reflection` is empty (no description written):

```typescript
if (hadGym && evening) {
  recentActivity.push(`${label}: lifted + ${evening}`)
} else if (hadGym) {
  recentActivity.push(`${label}: lifted weights`)
} else if (evening) {
  recentActivity.push(`${label}: ${evening}`)
} else if (checkin?.evening_actual_training) {
  recentActivity.push(`${label}: trained (no details logged)`)
} else if (i < 5) {
  recentActivity.push(`${label}: nothing logged`)
}
```

## Steps

1. Open `src/app/api/gym/coach/route.ts`
2. Apply Fix 1 to the `checkinTrainingDays` filter
3. Apply Fix 2 to the `evening` variable and the activity loop
4. `npx tsc --noEmit` — zero errors
5. Test: tap "Hype Me Up" in the Gym tab — should stream a response
6. `git add -A && git commit -m "fix: gym coach crash — evening_actual_training is bool not string" && git push`
