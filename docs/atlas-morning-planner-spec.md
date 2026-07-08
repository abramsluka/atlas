# Atlas — Morning Planner (“Plan Your Day”) Spec

> Status: **implemented + verified** (2026-07-08). All three phases live; flow verified end-to-end over HTTP (create → Haiku plan-gen → refine → tick from Home → cleanup).
> Inspired by Stoic’s morning “Plan Your Day”. Lives entirely inside the existing Journal feature.

## 1. Goal

One Journal, two modes:

- 🌙 **Night** — reflection. Exactly today’s behavior, unchanged.
- ☀️ **Morning** — *plan the day*. Brain-dump by voice or text, an AI turns it into an ordered checklist, you refine it in a voice/text back-and-forth, then save. The checklist is a live object: it surfaces on Home and can be ticked off there.

The plan lives **mainly in the Journal tab** (source of truth). Home is a read/write window into today’s plan.

Non-negotiables carried from the existing code:
- Reuse the reflect/reply streaming + voice machinery already on the entry detail page. No new plumbing.
- Follow the Supabase client rules in `CLAUDE.md` (`createClient()` for auth only, `createServiceClient()` for all DB ops).
- Night mode must be byte-for-byte unchanged in behavior.

---

## 2. Where it lives (decided)

| Concern | Decision |
|---|---|
| Tab | Journal. No new tab, no new route tree. |
| Storage | Same `journal_entries` table + two new columns (`kind`, `plan`). |
| Plan generation + refine | On the **entry detail page** (`/journal/[id]`), reusing the reflect/reply pattern. The AI writes into a **plan checklist** instead of a green reflection bubble. |
| Capture | `/journal/new` stays a capture surface (voice or text + the mode toggle). |
| Home | `TodaysCallCard` becomes collapsible; a new **Day Plan** card sits directly under it. |

---

## 3. Data model

### Migration — `supabase/migrations/20260708000000_journal_morning_planner.sql`

```sql
alter table journal_entries
  add column if not exists kind text not null default 'night'
    check (kind in ('morning', 'night')),
  add column if not exists plan jsonb not null default '[]'::jsonb;

-- Home reads "today's morning entry" on every load; index the lookup.
create index if not exists journal_entries_user_date_kind
  on journal_entries (user_id, date desc, kind);
```

Run it directly via psql from `.env.local` (per project convention). Existing rows backfill to `kind = 'night'`, `plan = []` — correct, they’re all reflections.

### `plan` shape

```ts
interface PlanItem {
  id: string      // stable; crypto.randomUUID() at creation (client or server)
  text: string    // one action, short. "Morning run", not "I think I want to go for a run"
  done: boolean
}
```

Stored as a JSONB array on the morning entry. `done` is only meaningful for morning entries; night entries keep `plan = []`.

### Types — `src/features/journal/types.ts`

Add to `JournalEntry`:
```ts
kind: 'morning' | 'night'
plan: PlanItem[]
```

Extend the Zod schemas:
```ts
export const PlanItemSchema = z.object({
  id: z.string(),
  text: z.string().max(500),
  done: z.boolean(),
})

// CreateEntrySchema: add
kind: z.enum(['morning', 'night']).default('night'),
plan: z.array(PlanItemSchema).default([]),

// UpdateEntrySchema: add
kind: z.enum(['morning', 'night']).optional(),
plan: z.array(PlanItemSchema).optional(),
```

`POST /api/journal` (`route.ts`) must persist `kind` and `plan` on insert. `PATCH /api/journal/[id]` must accept partial `kind` / `plan` updates. Both already `select('*')`, so reads carry the new columns automatically.

---

## 4. Feature 1 — Morning vs Night core

### 4.1 Mode toggle pill

A small pill rendered next to the date header on **both** `/journal/new` and `/journal/[id]`.

- Shows the current mode: `☀️ Morning` or `🌙 Night`.
- **Tap flips it.** No dropdown — two states, one control.
- Not a `<select>`; a `<button>` that toggles.

New-entry default by time of day:
```ts
const MORNING_CUTOFF_HOUR = 12 // before noon → morning
const defaultKind = new Date().getHours() < MORNING_CUTOFF_HOUR ? 'morning' : 'night'
```
The toggle always overrides the default.

On `/journal/[id]`, flipping the toggle PATCHes `kind` and swaps the body UI:
- → morning: render the plan checklist + “Plan my day” affordance.
- → night: render today’s reflection UI (unchanged).

### 4.2 List icon — `src/app/journal/JournalClient.tsx`

Prefix each entry’s title with its mode glyph based on `entry.kind`:
- morning → `☀️`
- night → `🌙`

Put it before the title text (`entry.title || entry.body.slice(0,80) || 'Voice note'`). For a morning entry with a plan and no title, fall back to the first plan item’s text, else `"Morning plan"`.

### 4.3 Mood

- Night: mood selector unchanged ("How are you feeling?").
- Morning: mood selector shown too, reframed as **"How are you feeling about today?"** — a morning feeling about the day ahead vs the night's reflection. (Reversed 2026-07-08: originally hidden, but mood-less rows left gaps in the list's mood-dot column.) Same 1–5 emoji scale, same `mood` column.

---

## 5. Feature 2 — Plan Your Day flow

### 5.1 Capture (`/journal/new`, morning mode)

- Placeholder becomes **“What’s the plan for today?”**
- **Typed:** on Save, split the textarea by newlines (trim, drop blanks) → `plan: PlanItem[]` with `done: false`. Create the entry with `kind='morning'`, that `plan`, and `body` = the raw text (kept for reference / re-parse). Redirect to `/journal/[id]`.
- **Voice:** on Save, create the morning entry, upload audio to `entry.audio_path` (existing `uploadJournalAudio`), redirect to `/journal/[id]`. The detail page then offers **“Plan my day.”**

### 5.2 Generate + refine (`/journal/[id]`, morning mode)

This mirrors the existing reflect → reply loop in `EntryDetail.tsx`, but the AI output is the plan checklist, not a paragraph.

**Primary action button** (where night shows “Get reflection”):
- Reads **“Plan my day”** when the morning entry has a recording and an empty plan.
- Tapping it calls `POST /api/journal/[id]/plan` (no body) → server transcribes `entry.audio_path`, sends the transcript to Haiku, saves and returns the plan → renders the checklist.

**The plan checklist** (replaces the body textarea for morning entries):
- One row per `PlanItem`: a checkbox + inline-editable text.
- Checking an item sets `done: true` with a **light strikethrough** on the text.
- Add a line, delete a line, edit text inline. (Drag-reorder is optional / future — see §9.)
- Auto-saves via `PATCH /api/journal/[id]` with the full `plan` array, debounced ~1s (reuse the `scheduleAutoSave` pattern already in `EntryDetail.tsx`).

**Refine** (mirrors the reply input at the bottom of the reflection thread):
- Text: type an instruction (“move the run after the gym, add lunch with Alex”) → `POST /api/journal/[id]/plan` with `{ message }`.
- Voice: record → upload via `uploadAudioToStorage(entryId, file, { reply: true })` → `POST /api/journal/[id]/plan` with `{ audioPath }`.
- Either way the server passes the **current plan + the instruction** to Haiku and returns the **updated full plan**, preserving `done` (see §6.3). Repeat until satisfied. **Save** persists (auto-save already covers it; the explicit Save button just navigates back like today).

Night mode on the detail page: no changes. Same reflect/reply/transcribe/go-longer behavior.

---

## 6. API — `POST /api/journal/[id]/plan`

New route: `src/app/api/journal/[id]/plan/route.ts`. Model the auth + service-client + entry-fetch preamble on `reflect/route.ts` and `reply/route.ts`.

### 6.1 Request

```ts
// First generation from the entry's own recording:
POST /api/journal/{id}/plan            // empty body → uses entry.audio_path

// Refine via freshly-recorded voice note:
POST /api/journal/{id}/plan   { "audioPath": "user-id/entry-id/reply-....webm" }

// Refine via text:
POST /api/journal/{id}/plan   { "message": "drop the errands, add gym after lunch" }
```

### 6.2 Server flow

1. Auth (`createClient().auth.getUser()`), 401 if no user.
2. Load the entry with `createServiceClient()`, scoped to `user.id`; 404 if missing.
3. Resolve the transcript:
   - `audioPath` present → transcribe that file (reuse the `reply` route’s transcription path).
   - else if `message` present → use it directly as the instruction.
   - else (first gen) → `ensureEntryTranscript(db, entry)` on `entry.audio_path` (from `src/lib/journalAudio.ts`), same as `transcribe/route.ts`.
4. Call Haiku (`claude-haiku-4-5`) with the planner prompt (§7). Non-streaming — plan generation is a single fast call; show a loading state, no need to stream tokens.
5. Parse the JSON array of strings. Build `PlanItem[]` (new `id` per line, `done: false`).
6. **Preserve `done`** across refines (§6.3).
7. Save: `db.from('journal_entries').update({ plan, updated_at: now })`.
8. Return `{ plan: PlanItem[] }`.

Set `export const maxDuration = 60` (transcription + model call), matching the other journal AI routes.

### 6.3 Preserving checked items on refine

When refining an existing plan, keep items the user already ticked:
```ts
const prevDone = new Set(
  currentPlan.filter(p => p.done).map(p => p.text.trim().toLowerCase())
)
const plan = haikuLines.map(text => ({
  id: crypto.randomUUID(),
  text,
  done: prevDone.has(text.trim().toLowerCase()),
}))
```
Fuzzy but good enough: an unchanged line that was done stays done; a reworded line resets to undone (acceptable — the user changed it).

### 6.4 Model note

Use `claude-haiku-4-5` (confirmed current Haiku id — cheap, fast, right for a parse). The rest of the app uses `claude-sonnet-4-6`; the planner deliberately uses Haiku per Luka’s call. Instantiate `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })` as elsewhere.

Parsing: prompt Haiku to return a bare JSON array of strings and extract with the same regex-guarded `JSON.parse` used in `todays-call/route.ts` (`raw.match(/\[[\s\S]*\]/)`). Structured outputs (`output_config.format`) are an option but the regex-extract pattern is already established in this codebase — prefer consistency.

---

## 7. Planner prompt (the AI core)

Haiku receives a **system prompt** (fixed) + a **user message** (the transcript, and for refines, the current plan). It must behave like a smart transcriber (Wispr-Flow-style): understand spoken corrections, not just transcribe.

### 7.1 System prompt

```
You turn a spoken or typed brain-dump into a clean, ordered plan for the day.

Rules:
- Output ONE line per distinct thing the person intends to do today.
- Preserve the order they intend. If they imply sequence ("first… then… after that…"),
  order accordingly. Otherwise keep the order they said things.
- Obey spoken corrections. Treat "scratch that", "actually", "no wait", "instead",
  "change that to", "never mind", "remove", "delete" as edits — apply them and do NOT
  include the retracted version. If they replace X with Y, output Y only.
- Merge duplicates. If they mention the same task twice, keep it once.
- Strip filler, hedging, and self-talk ("um", "I guess", "I think maybe I should").
  Keep only the action.
- Each line is short and action-first: "Morning run", "Gym — push day",
  "Deep work: Atlas planner", "Lunch with Alex". Imperative or noun phrase, not a sentence.
- Do NOT invent tasks, times, or detail they didn't say. Do NOT add commentary,
  encouragement, headers, numbering, or bullet characters.
- Keep their own wording where reasonable; you are tidying, not rewriting their day.

Return ONLY a JSON array of strings, one string per plan item, in order.
Example: ["Morning run","Gym — push day","Deep work: Atlas planner","Lunch with Alex"]
If there is no actionable content, return [].
```

### 7.2 User message — first generation

```
Here is what I said I want to do today. Turn it into my ordered plan.

<brain_dump>
{transcript}
</brain_dump>
```

### 7.3 User message — refine

Pass the current plan so the model edits in place rather than starting over:

```
This is my current plan for today:

<current_plan>
{currentPlan.map((p,i) => `${i+1}. ${p.text}`).join('\n')}
</current_plan>

Apply this change and return the full updated plan in order:

<change>
{transcript || message}
</change>
```

The same system prompt applies. The model returns the complete revised array (not a diff).

---

## 8. Feature 3 — Home / HUD

All in `src/app/HomeClient.tsx`, plus a home read for today’s plan.

### 8.1 `TodaysCallCard` → collapsible

Current card: `HomeClient.tsx:600`. Add:
- A `collapsed` boolean, persisted in `localStorage` under `atlas:todaysCall:collapsed`.
- Collapsed: show only the header row (the “Today’s Call” label + the verdict chip — the green/yellow/red pill). Hide headline + bullets.
- Expanded: exactly what renders today.
- Toggle by tapping the header (add a small chevron for affordance). Default: expanded on first ever load (no stored value).

### 8.2 New `DayPlanCard` — directly under Today’s Call

Rendered immediately after `<TodaysCallCard />` (~`HomeClient.tsx:986`).

Data: today’s morning entry’s plan. Provide it two ways, mirroring `TodaysCallCard`’s seed+fetch pattern:
- **Server seed:** extend `getHomeInitialData` (`src/lib/home/getHomeInitialData.ts`) with a `todaysPlan` read — the latest `journal_entries` row for `user_id`, `date = today`, `kind = 'morning'`; return `{ entryId, plan }` or `null`. Add it to `HomeInitialData` and thread through `HomeClient` props like `initialTodaysCall`.
- **Client fallback:** if not seeded, the card fetches it (small `GET /api/home/day-plan` returning the same shape, or reuse a journal query filtered client-side).

Card behavior:
- Show the **next 2–3 unchecked** items (`plan.filter(p => !p.done).slice(0, 3)`), each with a checkbox.
- **Tick from Home:** optimistic toggle → `PATCH /api/journal/{entryId}` with the full updated `plan`. Light strikethrough animates in; the ticked item drops out of the preview on next render (revealing the next unchecked one). Invalidate the relevant query keys.
- **Tap the card body** (not a checkbox) → route to `/journal/{entryId}` for the full list.
- If there are more than 3 unchecked, show a subtle “+N more →” affordance to the entry.
- **Empty state** (no morning entry today): a soft “☀️ Plan your day” prompt linking to `/journal/new`. Since it’s morning by default before noon, the new entry opens in morning mode; after noon the user can flip the toggle.
- If the whole plan is checked: show a quiet “Day planned ✓” state, or collapse the card. (Pick the quieter option.)

Keep the card visually consistent with `TodaysCallCard` / `DailyCheckinCard` (same rounded panel, border, muted labels).

---

## 9. Edge cases & gotchas

- **Night entries never get a plan UI.** Gate the whole plan checklist + “Plan my day” button on `entry.kind === 'morning'`.
- **Empty transcript / no actionable content:** Haiku returns `[]`. Show an empty checklist with an “add a line” affordance; don’t error.
- **Transcription failure:** surface the error inline (reuse the `reply`/`reflect` error handling); keep the recording so the user can retry — the create/upload retry guard (`createdEntryId` ref in `new/page.tsx`) already handles duplicate-entry avoidance.
- **Refine race with Home:** Home toggles `done` by sending the full plan; the journal detail auto-saves the full plan. Last write wins. Acceptable; both operate on the same array and toggling is idempotent per item id. If it ever matters, switch to a per-item toggle endpoint (future).
- **Title generation:** every morning plan gets a short auto-title (Luka’s call, 2026-07-08 — untitled cards showed raw plan-item text and overflowed). Typed entries title at create (`generateTitle(body)`); voice entries title from the transcript during transcription; the `/plan` route backfills from the plan lines if still untitled after generation. `generateTitle` is Haiku, 2–5 words — never the whole entry.
- **`user_id NOT NULL`** everywhere — already handled by the create route; the new columns don’t change that.
- **`src/proxy.ts`** bypass lists: `/api/journal/[id]/plan` is a normal authed route (needs the session cookie), so it does **not** need a bypass entry. Don’t add one.
- **Do not touch the legacy `/workouts` tables** — unrelated.

---

## 10. Files to touch

**New**
- `supabase/migrations/20260708000000_journal_morning_planner.sql`
- `src/app/api/journal/[id]/plan/route.ts`
- `DayPlanCard` (in `HomeClient.tsx` or a small colocated component)
- optional `GET /api/home/day-plan` (client-fallback source)

**Changed**
- `src/features/journal/types.ts` — `JournalEntry`, `CreateEntrySchema`, `UpdateEntrySchema`, `PlanItem`, `PlanItemSchema`
- `src/app/api/journal/route.ts` — persist `kind` + `plan` on insert
- `src/app/api/journal/[id]/route.ts` — accept `kind` + `plan` on PATCH
- `src/app/journal/new/page.tsx` — mode toggle, morning placeholder, typed→plan split, hide mood on morning
- `src/app/journal/[id]/EntryDetail.tsx` — mode toggle, plan checklist + “Plan my day” + refine loop for morning; night unchanged
- `src/app/journal/JournalClient.tsx` — ☀️/🌙 glyph per entry
- `src/app/HomeClient.tsx` — collapsible `TodaysCallCard`; render `DayPlanCard`
- `src/lib/home/getHomeInitialData.ts` — seed `todaysPlan`
- `src/features/journal/mutations.ts` / `queries.ts` — if a dedicated plan mutation/query is cleaner than reusing `useUpdateEntry`

---

## 11. Build order (phases)

1. **Schema + types.** Migration, `types.ts`, create/PATCH routes accept `kind`/`plan`. Verify a morning entry round-trips.
2. **Morning/Night core + planner.** Toggle pill, list glyphs, hide-mood-on-morning, `/api/journal/[id]/plan` route + Haiku prompt, the plan checklist + refine loop on detail. This is the meat.
3. **Home / HUD.** Collapsible Today’s Call; Day Plan card with check-off + write-back + empty-state nudge.

Ship and verify each phase (drive the real flow, not just typecheck) before the next.

---

## 12. Out of scope (unless asked)

- Drag-to-reorder plan items (add/edit/delete + AI reordering cover v1).
- Carrying an unfinished plan forward to the next day.
- Per-item times / reminders / notifications.
- Streaming the plan generation token-by-token (non-streaming Haiku is fast enough).
- A dedicated per-item toggle endpoint (full-array PATCH is fine at this scale).
