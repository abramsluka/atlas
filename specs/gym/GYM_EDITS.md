# Gym UI Edits

Three changes to `src/app/gym/GymClient.tsx` and related files. Build them in order.

---

## Edit 1 — GYM / DAY labels + larger filter buttons

**Where:** The two chip rows inside the Progressive Overload Coach section (`~lines 651–683` in `GymClient.tsx`).

**What to change:**

Each row currently renders small rounded-full chips with no label. Replace both rows with a labelled row layout matching the reference image: a short all-caps label on the left (`GYM` / `DAY`) and the buttons filling the remaining width as a segmented control.

**Target layout per row:**

```
[ GYM ]  [ Home Gym          ]  [ Commercial Gym   ]
[ DAY ]  [ Push ]  [ Pull ]  [ Legs ]
```

- Label: `text-[10px] font-bold tracking-[0.18em] uppercase text-white/30 w-10 flex-shrink-0`
- Container: `flex items-center gap-3`
- Button track: `flex-1 flex rounded-xl bg-white/5 border border-white/8 p-1 gap-1`
- Each button: `flex-1 rounded-lg py-2.5 text-sm font-semibold transition-colors`
  - Active: `bg-white text-black shadow-sm`
  - Inactive: `text-white/40`
- The active GYM button uses white fill. The active DAY button also uses white fill (not green — remove the `bg-green-400` it has now).

This gives buttons that are taller and visually grouped, matching the segmented-control look in the screenshots. No functional change — `setFilterGym` / `setFilterDay` stay identical.

---

## Edit 2 — Data section in settings modal

**Where:** Settings modal in `GymClient.tsx` (`~lines 1410–1515`). Add a new "Data" section between the Days section and the Save button.

**Three actions:**

### Export JSON
Serializes the user's full gym dataset — `gym_config`, `gym_exercises`, and `po_logs` — and triggers a browser download as `atlas-gym-export-YYYY-MM-DD.json`.

Client-side fetch pattern:
```typescript
async function handleExport() {
  const res = await fetch('/api/gym/export', { method: 'GET' })
  const json = await res.json()
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `atlas-gym-export-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
```

**New API route `src/app/api/gym/export/route.ts`:**
- Auth check
- Pull `gym_config`, `gym_exercises`, `po_logs` in parallel via `createServiceClient()`
- Return `{ config, exercises, logs }`

### Import JSON
Opens a hidden `<input type="file" accept=".json">`. On file select, reads JSON, POSTs to `/api/gym/import`. On success, invalidate TanStack queries `['gym-config']`, `['gym-exercises']`, `['po-logs']` and close settings.

**New API route `src/app/api/gym/import/route.ts`:**
- Auth check
- Parse body `{ config, exercises, logs }`
- Upsert `gym_config` (single row via `onConflict: 'user_id'`)
- Delete then re-insert `gym_exercises` for this user
- Delete then re-insert `po_logs` for this user
- Return `{ ok: true }`

### Reset all
A red-outlined button ("Reset all"). On click, show a `window.confirm('Delete all gym data? This cannot be undone.')`. If confirmed, DELETE from `gym_exercises` and `po_logs` for this user, then upsert `gym_config` back to the default config. Invalidate all gym queries.

**No new route needed** — call `DELETE /api/gym/exercises` (if it exists) or add a `DELETE` handler to `/api/gym/config/route.ts` that wipes config + cascades. Actually simpler: add a `DELETE /api/gym/reset` route that does all three deletes.

**UI for the section (goes above the Save button):**

```tsx
<div>
  <label className="text-xs text-white/40 uppercase tracking-wider block mb-3">Data</label>
  <div className="flex gap-2">
    <button
      onClick={handleExport}
      className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm font-medium text-white active:opacity-70"
    >
      Export JSON
    </button>
    <button
      onClick={() => importRef.current?.click()}
      className="flex-1 rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm font-medium text-white active:opacity-70"
    >
      Import JSON
    </button>
    <button
      onClick={handleReset}
      className="flex-1 rounded-xl border border-red-500/40 px-4 py-3 text-sm font-medium text-red-400 active:opacity-70"
    >
      Reset all
    </button>
  </div>
  <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
</div>
```

Add `const importRef = useRef<HTMLInputElement>(null)` to the component's state block.

---

## Edit 3 — "Let coach decide" for Upgrade at Reps

This is the most involved change. The user should be able to set their rep ceiling manually **or** defer to the AI coach, which calculates the optimal number from their actual training data.

### Context

`upgrade_at_reps` is the rep count that triggers a weight increase: if the user hits this rep count in two consecutive sessions for a given exercise, the coach prescribes increasing the weight. It currently defaults to `12` and is a single global number. The right number is actually personal — it depends on training goals (hypertrophy vs. strength), current exercise performance, body weight trends, and physiological profile (age, sex).

### Data model change

Add a boolean field `upgrade_at_reps_auto: boolean` (default `false`) to `GymConfig` in `src/features/gym/types.ts`.

Add it to the `DEFAULT_CONFIG` in `/api/gym/config/route.ts`:
```typescript
upgrade_at_reps_auto: false,
```

### Settings UI

Replace the current upgrade-at-reps block with:

```tsx
<div>
  <label className="text-xs text-white/40 uppercase tracking-wider block mb-2">Upgrade at reps</label>
  <input
    type="number" min="1" max="30" value={settingsUpgradeAt}
    disabled={settingsUpgradeAtAuto}
    onChange={e => setSettingsUpgradeAt(parseInt(e.target.value) || 12)}
    className={`w-full rounded-xl bg-white/8 border border-white/10 px-4 py-3 text-sm text-white focus:outline-none
      ${settingsUpgradeAtAuto ? 'opacity-40 cursor-not-allowed' : ''}`}
  />
  <p className="text-xs text-white/30 mt-1">Hit this rep count 2 sessions in a row → increase weight</p>

  {/* Coach decide toggle */}
  <button
    onClick={() => setSettingsUpgradeAtAuto(v => !v)}
    className={`mt-3 flex items-center justify-between w-full rounded-xl px-4 py-3 border transition-colors ${
      settingsUpgradeAtAuto
        ? 'bg-white/10 border-white/20'
        : 'bg-white/5 border-white/10'
    }`}
  >
    <div className="text-left">
      <p className="text-sm font-medium text-white">Let coach decide</p>
      <p className="text-xs text-white/40 mt-0.5">
        {settingsUpgradeAtAuto
          ? coachRepRec
            ? `Coach says: ${coachRepRec.reps} reps — ${coachRepRec.reason}`
            : 'Asking coach…'
          : 'AI sets this based on your training data'}
      </p>
    </div>
    <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${settingsUpgradeAtAuto ? 'bg-white' : 'bg-white/20'}`}>
      <div className={`w-4 h-4 rounded-full transition-transform ${settingsUpgradeAtAuto ? 'bg-black translate-x-4' : 'bg-white/60'}`} />
    </div>
  </button>

  {settingsUpgradeAtAuto && coachRepRec && (
    <p className="text-xs text-white/30 mt-2 leading-relaxed">{coachRepRec.reason}</p>
  )}
</div>
```

Add state:
```typescript
const [settingsUpgradeAtAuto, setSettingsUpgradeAtAuto] = useState(config.upgrade_at_reps_auto ?? false)
const [coachRepRec, setCoachRepRec] = useState<{ reps: number; reason: string } | null>(null)
```

When `settingsUpgradeAtAuto` flips to `true`, immediately fire a fetch to `/api/gym/coach-reps` and set `coachRepRec`. If the toggle is turned off, clear `coachRepRec` and restore the manual `settingsUpgradeAt` value.

When saving settings, if `settingsUpgradeAtAuto` is true and `coachRepRec` is set, write `coachRepRec.reps` into `settingsUpgradeAt` before saving — so the actual `upgrade_at_reps` number stored is the coach's recommendation, and `upgrade_at_reps_auto` is stored as `true` so the UI knows to show the coach label on next open.

### New API route: `src/app/api/gym/coach-reps/route.ts`

```typescript
POST /api/gym/coach-reps
```

This route pulls all relevant context and asks Claude to recommend the optimal `upgrade_at_reps` value.

**Data to pull (all in parallel):**

```typescript
const [configRes, exercisesRes, logsRes, profileRes, bodyweightRes] = await Promise.all([
  db.from('gym_config').select('*').eq('user_id', user.id).maybeSingle(),
  db.from('gym_exercises').select('*').eq('user_id', user.id),
  db.from('po_logs').select('*').eq('user_id', user.id)
    .order('logged_at', { ascending: false }).limit(200),
  db.from('health_profile').select('age, sex, weight_goal').eq('user_id', user.id).maybeSingle(),
  db.from('body_weight_logs').select('weight_lbs, logged_at').eq('user_id', user.id)
    .order('logged_at', { ascending: false }).limit(14),
])
```

**Context to build for the prompt:**

- Profile: age, sex (from `health_profile`)
- Current body weight + 14-day trend
- Number of distinct exercises tracked
- Average reps logged across all exercises in last 30 days
- How many times the current `upgrade_at_reps` was hit in the last 30 days (i.e., how often progressions are triggering)
- Progression rate: how many weight increases have happened in the last 30 days
- Rep ranges across exercises (min_rep to max_rep from `gym_exercises`)

**Prompt (non-streaming, JSON response):**

System:
```
You are an expert strength and conditioning coach. You will be given a user's training data and profile. Your job is to recommend a single "upgrade_at_reps" number — the rep ceiling at which they should increase weight. This number should be set so that progressions happen roughly every 2–4 weeks for most exercises, balancing hypertrophy (8–15 rep range) and progressive overload. Return ONLY valid JSON: { "reps": number, "reason": string }. The reason should be 1 sentence, specific to their data.
```

User message: structured context string built from the data above.

**Response handling:**
- Parse the JSON from Claude's response
- Return `{ reps: number, reason: string }` to the client

The route should use `anthropic.messages.create()` (not streaming — it's a quick structured response).

**Error handling:** If Claude fails or returns unparseable JSON, fall back to returning `{ reps: 12, reason: "Default recommendation" }` with a 200 so the UI doesn't break.

### openSettings sync

When `openSettings()` is called, also reset `settingsUpgradeAtAuto` to `config.upgrade_at_reps_auto ?? false` and clear `coachRepRec`.

---

## Files to create/modify

```
src/app/gym/GymClient.tsx                  ← edits 1, 2, 3
src/features/gym/types.ts                  ← add upgrade_at_reps_auto to GymConfig
src/app/api/gym/config/route.ts            ← add upgrade_at_reps_auto to DEFAULT_CONFIG
src/app/api/gym/export/route.ts            ← new
src/app/api/gym/import/route.ts            ← new
src/app/api/gym/reset/route.ts             ← new
src/app/api/gym/coach-reps/route.ts        ← new
```

## Completion checklist

1. `npx tsc --noEmit` — zero errors
2. Check `/tmp/atlas-dev.log` for runtime errors
3. Test gym/day selectors visually match reference screenshot
4. Test export downloads a valid JSON file
5. Test "Let coach decide" fires and shows a recommendation
6. `git add -A && git commit -m "feat: gym filter labels, data export/import, coach-decides reps" && git push`
