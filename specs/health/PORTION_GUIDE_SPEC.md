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

Rows come from the WebMD Portion Size Guide (Kathleen Zelman, MPH, RD, LD; 2008;
healthyeating.webmd.com), with the hand-based set the prompt already uses mapped onto the
same measures. Grams are per category because a "cup" is not one weight. Some WebMD
objects are dated (cassette tape, compact disc, checkbook); the table stores them and a
modern stand-in the prompt prefers.

**Basic equivalences** (the spine everything below hangs on)

| Measure | Object | Modern stand-in | Hand |
|---|---|---|---|
| 1 cup | baseball | — | fist |
| ½ cup | lightbulb | — | cupped hand |
| 1 oz or 2 tbsp | golf ball | — | — |
| 1 tbsp | poker chip | — | whole thumb |
| 1 tsp | die | — | thumb tip |
| 3 oz meat / poultry / tofu | deck of cards | — | palm, no fingers |
| 3 oz fish | checkbook | smartphone | palm |
| 1 oz lunch meat / 1 pancake | compact disc | — | — |
| 1 slice bread | cassette tape | — | — |
| 3 oz muffin or biscuit | hockey puck | — | — |
| 1½ oz cheese | 3 stacked dice | — | — |

**Per-category rows** (what the prompt offers and `resolvePortion` matches)

| Category | Reference | Measure | Grams |
|---|---|---|---|
| grains | baseball | 1 cup cereal flakes | 30 |
| grains | lightbulb | ½ cup cooked rice or pasta | 90 |
| grains | baseball | 1 cup cooked rice or pasta | 175 |
| grains | compact disc | 1 pancake | 40 |
| grains | cassette tape | 1 slice bread | 30 |
| grains | 6 oz tuna can | 1 bagel | 100 |
| grains | 3 baseballs | 3 cups popcorn | 24 |
| dairy | 3 stacked dice | 1½ oz cheese | 42 |
| dairy | baseball | 1 cup yogurt or milk | 240 |
| dairy | lightbulb | ½ cup frozen yogurt or ice cream | 70 |
| fats | poker chip | 1 tbsp butter, spread, dressing, mayo, oil | 14 |
| fats | die / thumb tip | 1 tsp oil or butter | 5 |
| fruit | baseball | 1 medium fruit | 150 |
| fruit | about 16 grapes | ½ cup grapes | 75 |
| fruit | about 12 berries | 1 cup strawberries | 150 |
| veg | baseball | 1 cup salad greens | 30 |
| veg | about 12 baby carrots | 1 cup carrots | 130 |
| veg | baseball | 1 cup cooked vegetables | 150 |
| veg | computer mouse | 1 medium baked potato | 150 |
| protein | deck of cards | 3 oz lean meat or poultry | 85 |
| protein | checkbook | 3 oz grilled or baked fish | 85 |
| protein | deck of cards | 3 oz tofu | 85 |
| protein | compact disc | 1 oz lunch meat | 28 |
| nuts | golf ball | 2 tbsp peanut butter or hummus | 32 |
| nuts | 23 almonds | ¼ cup almonds | 35 |
| nuts | 24 pistachios | ¼ cup pistachios (shelled) | 30 |
| nuts | golf ball | 1 oz nuts | 28 |
| sweets | dental floss package | 1 piece chocolate or 1 brownie | 30 |
| sweets | deck of cards | 1 slice cake | 80 |
| sweets | about 2 poker chips | 1 cookie | 30 |
| sweets | hockey puck | 3 oz muffin or biscuit | 85 |
| mixed | baseball / fist | 1 cup casserole, chili, stir-fry | 240 |

Scaling: size questions offer ½×, 1×, 1½×, 2× of the row's anchor, phrased with the
object ("half a deck", "a deck of cards", "a deck and a half", "two decks"). Thickness
follow-ups for meat ("one finger", "two fingers", "three fingers") stay as multipliers on
the deck-of-cards anchor (×0.7, ×1.0, ×1.4).

**Plate method.** WebMD's plate split (½ vegetables, ¼ protein, ¼ starch) gives the
existing plate-coverage vocabulary a value: on a standard dinner plate, a quarter-plate of
protein ≈ deck of cards (85 g), a quarter-plate of starch ≈ 1 cup (175 g grains, 150 g
potato), a half-plate of vegetables ≈ 1½–2 cups (225–300 g). "Heaping" doubles the
starch and protein rows. Count references ("2 tacos", "half the burrito") remain
unanchored; they are relative to the item.

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
