# Day Plan: Concise Tasks + Doc-Style Line Editing + Live Home Card

Three fixes to the morning plan feature. No schema changes, no new API routes. Plan
items stay `{ id, text, done }` jsonb on `journal_entries.plan`.

## Part 1 — Concise task extraction (prompt change only)

**File:** `src/app/api/journal/[id]/plan/route.ts` (`PLANNER_SYSTEM`)

**Problem.** When the brain-dump is long and rambly, the model preserves the rambling
phrasing and outputs near-verbatim sentences instead of task lines. The current prompt
pushes it there with "Keep their own wording where reasonable" and allows bare noun
phrases, so output swings between too-verbatim and too-terse ("Range or climbing").

**Target format.** Every line is a short verb-first action phrase, roughly 2 to 8 words:

- "Go to the range" or "Go climbing" — never bare nouns like "Range" or "Climbing"
- "Work out at 11:00" — keep times, durations, places, named people
- "Post-workout food: burrito, sushi, or sandwich" — alternatives stay on one line
- Never a full sentence with reasoning, hedging, or story attached

**Prompt changes:**

1. Replace the line-style rule ("Imperative or noun phrase, not a sentence") with:
   every line starts with a verb; bare noun fragments are too terse; sentences with
   justification are too long.
2. Replace "Keep their own wording where reasonable; you are tidying, not rewriting"
   with: keep their specifics (times, food options, places, people), but rewrite the
   phrasing freely into a short action line. When they ramble or tell a story around a
   task, extract only the action and drop the story.
3. Add one few-shot example: a rambling multi-sentence brain-dump paragraph and the
   3-4 short lines it should compress to. This anchors the compression level better
   than rules alone (it runs on Haiku).

Everything else stays: order preservation, spoken corrections, dedup, JSON schema
output, `claude-haiku-4-5`, done-state carryover on refine.

## Part 2 — Google-Docs-style editing of plan lines

**File:** `src/app/journal/[id]/EntryDetail.tsx` (plan list, ~lines 608-671).
Extract the plan list into a new `src/app/journal/[id]/PlanEditor.tsx` component
(props: `plan`, `onChange`, plus the toggle/planning bits it already uses).
EntryDetail keeps ownership of state and the debounced save. The keyboard logic adds
enough code that leaving it inline pushes EntryDetail past readable.

Each item stays its own auto-growing `<textarea>` (needed for wrap-under-checkbox),
but the textareas behave like lines of one document:

### Behaviors

1. **Enter splits at the caret.** Text after the caret moves into a new item directly
   below; caret lands at position 0 of the new item. Caret at end of text gives the
   current behavior (new empty item below). If text is selected, the selection is
   deleted first, then split. The new item is always `done: false`; the original keeps
   its done state.
2. **Backspace at caret position 0 merges into the previous line.** Previous item
   becomes `prev.text + current.text`, current item is removed, caret lands at the
   join point (end of the old prev text). On the first item it is a no-op. This is
   also how full keyboard deletion works: backspace through the text, then one more
   backspace removes the empty row. With a selection active, native behavior runs.
3. **Forward Delete at end of text merges the next line up** into the current item,
   caret stays where it is. (fn+Delete on Mac laptops, Delete on full keyboards.)
4. **ArrowUp / ArrowDown move between lines.** ArrowUp moves the caret to the
   previous item, ArrowDown to the next, preserving the caret's character offset
   clamped to the target's length. Wrapped items (long text on multiple visual
   lines): navigate up only when the caret is at index 0 and down only when at text
   end, so native caret movement still works inside the wrap. Single-visual-line
   items (the common case, detected by comparing scrollHeight to line height) always
   navigate.
5. **Touch paths are untouched.** Checkbox toggle, the x delete button, and
   "+ Add a line" all stay. The keyboard behaviors are additive; on iOS the Enter
   split and backspace-at-0 merge work from the software keyboard too.

6. **Undo / redo across structural edits.** The browser's native textarea undo
   only knows about text inside one box, so adding, splitting, merging, or
   deleting a row cannot be undone with it (a new line "sticks"). PlanEditor keeps
   its own history of whole-plan snapshots. Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z
   redoes (Ctrl+Y also redoes). Every edit — typing, checkbox toggle, ×, split,
   merge, add line — goes through one `commit()` that records a snapshot, so all
   of them are undoable. Consecutive typing in one line folds into a single undo
   step (600 ms idle gap starts a new one), and each snapshot restores the caret
   to where it was. History is capped at 100 steps and resets when a plan arrives
   from outside the editor (first load, AI generation, voice refine), so undo
   never rewinds across a plan the model just rebuilt.

### Implementation notes

- Replace `focusItemId: string | null` with a focus request `{ id: string, caret: number } | null`.
  A ref callback on each textarea applies `focus()` + `setSelectionRange(caret, caret)`
  when its id matches, then clears the request. Drop `autoFocus` (it cannot place the
  caret and only covered the create case).
- All split/merge/delete ops go through the existing `setPlanAndSave` debounce; blank
  rows still never persist (existing filter). No new persistence code.
- Skip all key handling while composing (`e.nativeEvent.isComposing`) so IME input
  is not broken.
- Merge keeps the surviving item's done state.

### Out of scope

- Home `DayPlanCard` stays read-only toggle plus link; no editing there.
- `journal/new` typed brain-dump path (`linesToPlan`) unchanged.
- Drag-to-reorder. Not asked for; revisit if line editing is not enough.

## Part 3 — Day Plan card updates without a page reload

**Files:** `src/app/HomeClient.tsx` (`DayPlanCard`), `src/features/journal/mutations.ts`,
`src/app/journal/[id]/EntryDetail.tsx` (`requestPlan`).

**Problem.** `DayPlanCard` holds its data in raw `useState`, seeded once from the
server prop, with a single fallback fetch on mount. Saving a morning entry and
navigating back to Home shows the stale card (or the "Plan your day" nudge) until a
full reload. This is also the one data surface in the app still on the raw
fetch-into-state pattern instead of TanStack Query.

**Fix.** Move the card onto TanStack Query and invalidate from the journal side:

1. New `useDayPlan()` hook (put it in `src/features/journal/queries.ts` next to the
   other journal queries, since the data is journal entries): `useQuery` with key
   `['home', 'day-plan']`, fetching `/api/home/day-plan`. Seed with the server prop
   via `initialData` plus `initialDataUpdatedAt: 0` so the seed renders instantly but
   counts as stale and revalidates on mount. Keep default `refetchOnWindowFocus` so
   resuming the PWA also refreshes it.
2. `DayPlanCard` drops its `useState`/`useEffect` and reads the query. The checkbox
   toggle becomes an optimistic `queryClient.setQueryData` update on the same key,
   with the existing PATCH write-through and revert-on-failure. The lingering
   strikethrough animation stays local state.
3. Invalidate `['home', 'day-plan']` everywhere the plan can change:
   - `useCreateEntry`, `useUpdateEntry`, `useDeleteEntry` in
     `src/features/journal/mutations.ts` (covers typed plans from `journal/new`,
     plan edits and item deletes in EntryDetail, kind switches, entry deletion)
   - `requestPlan` in EntryDetail (covers AI generation and voice/text refines),
     alongside the `['journal']` invalidations already there
4. Result: come back to Home after saving a morning entry and the card is already
   correct. No reload, no navigation-cache staleness, because the card no longer
   trusts the server seed once the cache says the data changed.

## Verify

1. Morning entry with a long rambling brain-dump, generate plan: lines come out
   verb-first and short, specifics kept, no bare nouns, no sentences.
2. Desktop: Enter mid-text splits, Enter at end adds a line, backspace at 0 merges,
   backspace-through-empty deletes the row, fn+Delete at end merges upward, arrows
   walk the list, caret lands where expected after every op.
3. Long wrapped item: arrows move within the wrap first, then across items.
3b. Undo: Enter a new line then Cmd+Z removes it and rejoins the text; × delete
   then Cmd+Z brings the row back; a burst of typing undoes as one step;
   Cmd+Shift+Z redoes each. Generating a plan clears the history.
4. iPhone PWA: toggle, x delete, add line, Enter split, backspace merge all work.
5. Refine flow still preserves done state; blank mid-edit rows never hit the DB.
6. Create a morning entry with a plan, hit back to Home: the Day Plan card shows the
   new plan immediately, no reload. Edit a line in the entry, go back: card reflects
   it. Delete the entry: card returns to the "Plan your day" nudge. Toggle a checkbox
   on Home, open the entry: done state matches.
