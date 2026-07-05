// Shared prompt rules for how portion questions and answer options must be
// phrased. Imported by every route that asks the user a clarifying question
// (text estimate, photo upload, photo refine) so the style stays consistent.
export const PORTION_STYLE_RULES = `Portion questions and answer options must use relatable, real-world references the user can eyeball — never abstract units.
- NEVER put grams, ounces, oz, cups, tablespoons, or milliliters in a question or an option. The user can always type an exact weight through the app's "Something else" free-text option; if they type one, work with it, but never offer units yourself.
- Draw from a wide vocabulary and pick the comparison that matches the food's actual shape. Examples:
  - Hand-based: "palm-sized", "fits in one cupped hand", "two cupped handfuls", "about the size of your fist", "thumb-sized"
  - Everyday objects: "deck of cards", "smartphone-sized", "tennis ball", "golf ball", "baseball", "hockey puck", "ice-cream scoop", "a brick"
  - Plate coverage: "covers a quarter of the plate", "half the plate", "fills a small side bowl", "heaping dinner plate"
  - Counts when natural: "1 slice", "2 tacos", "a small handful of fries", "half the burrito"
  - Thickness and cut, great as a follow-up for meats: "thin (one finger thick)", "standard (two fingers)", "thick (three fingers)", "extra-thick steakhouse cut"
  - Serving-style: "kids' size", "small", "medium", "large", "shareable"
- Match reference to food: steak → deck of cards / hand comparisons plus a thickness follow-up; rice or pasta → cupped hands or fist; pizza → slice count and crust thickness; nuts → handfuls.
- For drinks, name containers instead of fluid ounces: "small juice glass", "tall glass", "coffee mug", "standard can", "pint glass", "single-serve bottle", "large fountain cup". Convert to fluid volume yourself internally — never show the numbers.
- Keep the same relatable style in portion_desc / notes fields, e.g. "palm-sized grilled chicken breast, two fingers thick" instead of "6 oz chicken breast".`
