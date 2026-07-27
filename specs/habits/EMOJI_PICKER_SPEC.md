# Habit Emoji Picker Spec

Status: proposed (not yet built)
Area: Habits (`/habits`)
Author: Claude session, 2026-07-27

## Goal

Let a user pick **any** emoji as a habit's icon, not just a fixed set of presets.
Replace the preset palette row in the habit add/edit sheet with a tap-the-icon
flow that opens a searchable in-app emoji picker.

## Why not the native OS picker

There is no web API to summon the native iOS/Android emoji picker on demand. A
PWA cannot do it. The OS emoji keyboard only appears when a text field is
focused, and even then the phone opens in text mode (the user still has to tap
the emoji key). So the "tap the icon and the iOS picker slides up" behavior is
not achievable for a web app.

Every polished web app (Slack, Notion, Linear) solves this the same way: an
**in-app** searchable emoji picker. That is what this spec builds.

## Chosen approach

- **Trigger:** tap the icon itself (no separate "Change icon" button). A small
  "Icon" label sits above it for discoverability.
- **Picker:** an in-app searchable grid of every emoji, opened as a sub-view
  inside the existing bottom sheet. Search + scroll + pick, then return to the
  form with the new icon selected.
- **Drop** the current preset palette (`COMMON_EMOJIS` row) entirely.

## Library

Use [`emoji-picker-element`](https://github.com/nolanlawson/emoji-picker-element):

- Framework-agnostic Web Component (`<emoji-picker>`), lightweight, lazy-loads
  its data, strong built-in accessibility and search.
- Preferred over `emoji-mart` (heavier, React-version-coupled). We only need a
  picker, not a full React kit.

**Runtime data:** by default the element fetches emoji data JSON from a public
CDN (jsdelivr). To avoid an external runtime dependency (privacy, reliability,
PWA/offline), **self-host the data**: add `emoji-picker-element-data` to deps,
copy the `en/emojibase/data.json` into `public/emoji-data.json`, and set the
element's `data-source` / `dataSource` to `/emoji-data.json`. Document this in
the PR so the file is regenerated if the lib is bumped.

## Interaction / UX

Lives inside the existing `HabitEditSheet` (create + edit) in
`src/app/habits/HabitsClient.tsx`.

1. The sheet's "Icon" section becomes a single large tappable tile (~56px)
   showing the current emoji, with a subtle affordance (a small pencil/edit dot
   in the corner or a faint caret) signaling it opens something.
2. Tapping the tile swaps the sheet's body to a **"pick an icon" sub-view**:
   - A small `‹ Back` header (returns to the form, no change if they back out).
   - The `<emoji-picker>` filling the sheet body, dark-themed to match.
3. Selecting an emoji sets the icon and returns to the form automatically.
4. Name and frequency fields are unchanged.

Presenting the picker as a same-sheet sub-view (not a nested modal on top of the
sheet) keeps it to one surface and avoids stacked bottom sheets on mobile.

## Implementation notes

- **Client-only load.** The custom element touches `window`/`customElements`, so
  it must not run during SSR. Import it lazily on the client (dynamic
  `import('emoji-picker-element')` inside a `useEffect`, or a `next/dynamic`
  wrapper with `ssr: false`). Do not add a top-level `import` in a file that
  server-renders.
- **Event wiring.** Attach the picker via `ref` + `addEventListener('emoji-click', handler)`
  (and remove on cleanup). The handler reads `event.detail.unicode` for the
  emoji string. Do not rely on a React `onEmojiClick` prop; custom-element events
  are not auto-bound.
- **Theme.** App is dark. Set the picker to its dark theme (e.g. `class="dark"`
  or the documented dark attribute) and override its background/border CSS
  custom properties to match the sheet (`#111113`, `var(--cosmic-border)`).
- **Fallback.** If the element fails to load (data fetch error, unsupported
  engine), fall back to a plain emoji text input so the user can still type one.
- **Default.** Unchanged: an empty icon still defaults to `✅` on save.

## Data model

No changes. `habits.emoji` is already a free-text column and the create/edit
API already accepts any emoji string. This is purely a UI swap.

## Scope

**In scope:** replace the palette with the tap-to-open searchable picker in the
habit add/edit sheet; self-host emoji data; dark theme; SSR-safe load; fallback.

**Out of scope:** changing the icon affordance anywhere else (the Today/Week
cards keep rendering the stored emoji as-is); emoji search on the habit list;
skin-tone preferences persistence (the element handles skin tone in-session).

## Acceptance criteria

- In edit mode, tapping a habit's icon opens the searchable picker; choosing any
  emoji (including ones not in the old preset set) updates the habit and persists.
- Same flow works when creating a new habit.
- No preset palette row remains.
- No external network call at runtime for emoji data (self-hosted).
- Page still SSRs and builds cleanly; no hydration warnings from the element.
- Works on the mobile PWA (primary target) and desktop.

## Rough effort

Small-to-medium. One dependency, one self-hosted data file, and a localized
change to `HabitEditSheet` (swap the icon row + add the sub-view). No API,
schema, or migration changes.
