# Food Photo — User Description Prompt

## What to build

After the user takes a food photo, show a confirmation sheet before submitting. The sheet has:

1. **Photo preview** — thumbnail of the captured image
2. **Optional description field** — "What is this?" placeholder, free text (e.g. "chicken breast and white rice, about 6oz")
3. **Log it button** — submits photo + description together
4. **Retake / Cancel** — lets them discard and try again

## Why

Claude Vision is good at identifying food but can misread visually similar items (chicken vs fish, rice vs quinoa, steak vs pork). A one-line description from the user anchors the analysis:

- Confirms the protein source when visually ambiguous
- Provides portion context ("large bowl", "half plate") that vision can't reliably measure
- Lets the user flag preparation method ("fried", "grilled", "with butter") that affects calories
- Reduces the need to edit after the fact

## How to pass it to the API

Add a `description` field to the FormData POST alongside the existing `photo` blob:

```
fd.append('photo', resized, 'meal.jpg')
fd.append('description', userDescription.trim())   // empty string if not filled in
```

## How to use it in the Claude prompt (route.ts)

Inject the description into the user message when non-empty:

```
const descriptionLine = description
  ? `The user says: "${description}". Use this to guide your identification — trust it over visual guessing.`
  : ''

// Include descriptionLine in the Claude message alongside the image
```

If description is empty, the prompt behaves exactly as today — no regression.

## UI flow

```
[Camera opens]
       ↓
[Photo taken]
       ↓
[Sheet slides up]
  ┌─────────────────────────────┐
  │  [photo preview]            │
  │                             │
  │  What is this? (optional)   │
  │  [________________________] │
  │                             │
  │  [Log it]   [Retake]        │
  └─────────────────────────────┘
       ↓
[Uploads + estimates as before]
```

## State changes in FoodSection (HealthClient.tsx)

Add:
- `pendingFile: File | null` — holds the captured file until the user confirms
- `pendingPreview: string | null` — object URL for the thumbnail
- `description: string` — the optional text field value
- `sheetOpen: boolean` — controls the confirmation sheet

On file input change: set `pendingFile` + `pendingPreview`, open sheet — do NOT upload yet.
On "Log it": resize + upload with description appended, close sheet, clear state.
On "Retake": clear `pendingFile`/`pendingPreview`, re-trigger file input.
On "Cancel": clear all pending state, close sheet.

## Notes

- Description is optional — empty string is fine, don't require it
- Keep the existing `uploading` spinner behavior unchanged after submit
- The `fileInputRef` trick (reset `.value = ''` after each capture) already handles re-capture
- Sheet animation: `fixed inset-x-0 bottom-0` slide-up, same pattern as other sheets in the app
