# Portion Guide — anchored visual references for food logging

Status: spec, not built. Written 2026-09-15.

## Problem

`PORTION_STYLE_RULES` (src/features/food/portionStyle.ts) tells the model to phrase
portion questions with everyday references ("deck of cards", "palm-sized", "tennis
ball"). It never says what those references equal. The reference → quantity → calories
step is redone inside gpt-4o-mini on every call, unanchored, so:

- The same tapped answer resolves to different grams across calls.
- The model offers the same two or three references for every food category instead
  of the one a person can actually eyeball for that food (dice for cheese, poker chip
  for butter, half a baseball for rice).
- Calories come from the model's guess even when the ingredient library already has
  exact per-100 g numbers for the food.

## Goal

Make the portion step deterministic where it can be: a fixed anchor table drives which
references are offered per food category, what grams each resolves to, and (when the
food is known) the calorie arithmetic. Same UX, no extra taps.

## Non-goals

- Improving photo vision. The photo estimator keeps its own judgment; the table only
  standardizes the follow-up question it asks.
- Replacing the restaurant / preparation questions for composed dishes. Those move the
  estimate more than any object reference and stay as they are.
- Showing units to the user. Grams stay hidden in options, per the existing rule.

## The anchor table

New file `src/features/food/portionGuide.ts`. Typed data, one row per reference:

```ts
export type PortionCategory =
  | 'grains' | 'protein' | 'dairy' | 'fats' | 'fruit' | 'veg' | 'nuts' | 'snacks' | 'mixed'

export interface PortionAnchor {
  category: PortionCategory
  ref: string          // the words the user sees, e.g. "deck of cards"
  measure: string      // household measure it stands for, e.g. "3 oz"
  grams: number        // resolved weight for THIS category (density matters)
  examples?: string[]  // foods this applies to, for the prompt and the guide sheet
}
```

Rows, from the WebMD wallet guide plus the hand-based set the prompt already uses.
Grams are per category because a "cup" is not one weight:

| Category | Reference | Measure | Grams |
|---|---|---|---|
| grains | baseball / fist | 1 cup cooked rice, pasta, cereal | 175 |
| grains | half baseball / cupped hand | ½ cup cooked grains | 90 |
| grains | CD / DVD | 1 pancake or waffle | 40 |
| grains | hockey puck | 1 bagel | 100 |
| grains | slice of bread | 1 slice | 30 |
| protein | deck of cards / palm | 3 oz cooked meat, poultry, fish | 85 |
| protein | checkbook | 3 oz fish fillet | 85 |
| protein | half a palm | 1.5 oz | 45 |
| protein | two decks | 6 oz | 170 |
| protein | ping-pong ball | 2 tbsp peanut butter | 32 |
| dairy | 4 dice | 1 oz hard cheese | 28 |
| dairy | 6 dice | 1.5 oz cheese | 42 |
| dairy | baseball | 1 cup yogurt, milk, ice cream | 240 |
| dairy | tennis ball | ½ cup ice cream | 70 |
| fats | thumb tip / die | 1 tsp oil, butter, mayo | 5 |
| fats | poker chip / whole thumb | 1 tbsp butter, dressing, oil | 14 |
| fats | golf ball | 2 tbsp hummus, guacamole | 30 |
| fruit | baseball / fist | 1 medium whole fruit, 1 cup berries | 150 |
| fruit | tennis ball | ½ cup canned or cut fruit | 80 |
| fruit | golf ball | ¼ cup dried fruit | 40 |
| veg | baseball | 1 cup raw leafy greens | 30 |
| veg | fist | 1 cup cooked vegetables | 150 |
| veg | half baseball | ½ cup cooked vegetables | 75 |
| veg | computer mouse | 1 medium baked potato | 150 |
| veg | light bulb | ½ cup mashed potato | 105 |
| nuts | small handful / golf ball | 1 oz nuts | 28 |
| nuts | ping-pong ball | 2 tbsp nut butter | 32 |
| snacks | large handful / baseball | 1 oz chips, pretzels, popcorn (3 cups) | 28 |
| snacks | hockey puck | 1 muffin | 110 |
| snacks | 4 dice | 1 oz chocolate | 28 |
| mixed | fist / baseball | 1 cup casserole, chili, stir-fry | 240 |
| mixed | quarter of the plate | one component of a plated meal | scaled |

Plate-coverage and count references ("2 tacos", "half the burrito", "covers half the
plate") stay in the prompt as unanchored vocabulary; they are relative to the food and
cannot be given a fixed gram value. Thickness follow-ups for meat ("one finger", "two
fingers", "three fingers") stay too, as multipliers on the deck-of-cards anchor
(×0.7, ×1.0, ×1.4).

Two helpers:

```ts
// The compact, grouped rendering injected into prompts
export function renderPortionGuide(categories?: PortionCategory[]): string
// Resolve a tapped answer to grams, if it names a known reference for the category
export function resolvePortion(answer: string, category: PortionCategory): PortionAnchor | null
```

`resolvePortion` matches by normalized reference name and common variants (a small
alias list per row, e.g. "palm-sized" / "size of my palm" / "one palm"). Anything it
cannot match returns null and the model's own number stands, as today.

## Prompt changes

`PORTION_STYLE_RULES` loses its free-form vocabulary list (the "Hand-based / Everyday
objects" bullets) and gains the rendered guide plus two rules:

1. Options for a size question MUST come from the references listed for that food's
   category, spanning small → large (typically ½×, 1×, 1½×, 2× of the anchor). The
   plate-coverage and count vocabulary remains allowed where it fits better.
2. The response gains two optional fields on FINAL: `portion_grams` (integer, the
   weight the model actually used) and `portion_ref` (the reference it resolved from,
   or null). These are for auditing and the deterministic path below; nothing is shown
   to the user beyond the existing `portion_desc`.

The guide is rendered once at module load (it is static) and is ~40 lines, so the prompt
cost is small and identical on every call, which also makes it cacheable.

Affected routes, all already importing `PORTION_STYLE_RULES`:

- `src/app/api/health/food/estimate/route.ts` (text wizard)
- `src/app/api/health/food/route.ts` (photo, refine_question)
- `src/app/api/health/food/portion/route.ts` (photo grams for a barcode product; give it
  the table so its "plate/bowl/hand size" cue has numbers behind it)

## Deterministic calorie path

When a FINAL response carries `portion_grams` and the item resolves to an
`INGREDIENT_LIBRARY` entry (existing fuzzy match in `ingredientSearch.ts`, require a
strong match on name or alias), recompute calories / protein / carbs as
`per100 × portion_grams / 100` and overwrite the model's numbers. Set `notes` to
mention the anchor ("deck-of-cards chicken breast, 85 g"). When there is no library
match, keep the model's numbers.

This is the part that actually improves accuracy for simple foods. It is server-side
only, in the estimate route, after the model responds.

## UI

One small addition: a "Portion guide" sheet, reachable from the wizard's question step
(a small link under the options) and from Health settings. Static, grouped by category
like the wallet card: reference, what it equals, example foods. No interactivity beyond
scrolling. Component `src/app/health/PortionGuideSheet.tsx`, reading the same table, so
the sheet and the prompt can never disagree.

Nothing else in the entry flow changes. Options are still tappable chips; "Something
else" still accepts typed units.

## Testing

- `portionGuide.test.ts`: every row has grams > 0; `resolvePortion` hits for each
  reference and its aliases and misses on unrelated text; rendered guide contains every
  category header.
- Estimate route smoke, run by hand with a key: ten fixed descriptions ("chicken
  breast", "rice", "cheddar", "olive oil on a salad", "almonds", "banana", …) → the
  first question's options come from the right category, and picking the 1× anchor
  yields `portion_grams` equal to the table value.
- Photo route unchanged in output shape; confirm `refine_question.options` still parse.

## Rollout

1. Table + helpers + tests.
2. Prompt integration in the three routes (behavior change: options vocabulary).
3. Deterministic recompute in the estimate route.
4. Guide sheet.

Each step ships on its own. If step 3 produces worse numbers for some foods (library
entries with a bad `per100`), fix the library row; do not fall back to the model.

## Out of scope

Fat grams (Atlas tracks calories / protein / carbs only). Per-user hand-size
calibration ("my palm is 4 oz") is a possible later step: one setting that scales the
hand-based anchors.
