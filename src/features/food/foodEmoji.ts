// Keyword → emoji lookup for food logs. No AI call: every logged item resolves
// to an emoji from the table below, and the user can override it per-entry
// (food_logs.emoji / food_items.emoji), which always wins.
//
// Matching rules, in order:
//   1. The name is truncated at the first "with / and / , / (" style boundary so
//      "Onigiri with bonito flakes" resolves on "onigiri", not "flakes".
//   2. Every phrase in the table is matched on word boundaries against the
//      singularised tokens.
//   3. The match that ENDS latest wins — English compounds are head-final, so
//      "chicken caesar salad" → salad and "banana protein shake" → shake.
//      Ties go to the longer phrase, so "ice cream" beats "cream".

export type EmojiRule = readonly [emoji: string, ...words: string[]]

// Order only matters as a tiebreak between equal-length phrases ending at the
// same word, so group by kind and keep it readable.
const RULES: EmojiRule[] = [
  // ── Drinks ────────────────────────────────────────────────────────────────
  ['💧', 'water', 'sparkling water', 'electrolyte', 'lmnt', 'liquid iv', 'hydration'],
  ['☕', 'coffee', 'espresso', 'latte', 'cappuccino', 'americano', 'mocha', 'cold brew', 'flat white', 'macchiato', 'hot chocolate', 'cocoa', 'starbucks'],
  ['🍵', 'tea', 'matcha', 'chai', 'green tea', 'herbal tea'],
  ['🧋', 'boba', 'bubble tea', 'milk tea'],
  ['🧃', 'juice', 'lemonade', 'apple juice', 'orange juice', 'capri sun'],
  ['🥤', 'soda', 'coke', 'cola', 'pepsi', 'sprite', 'fanta', 'root beer', 'dr pepper', 'seltzer', 'tonic', 'diet coke'],
  ['⚡', 'energy drink', 'red bull', 'monster', 'celsius', 'alani', 'ghost energy', 'preworkout', 'pre workout'],
  ['🥛', 'milk', 'oat milk', 'almond milk', 'soy milk', 'whole milk', 'skim milk', 'kefir', 'fairlife', 'cream', 'heavy cream', 'half and half', 'almondmilk', 'oatmilk', 'creamer'],
  ['🥤', 'shake', 'smoothie', 'milkshake', 'frappe', 'frappuccino', 'protein shake', 'protein powder', 'whey', 'casein', 'collagen', 'huel', 'soylent', 'koia', 'shakeology'],
  ['🫧', 'kombucha', 'soda water', 'club soda'],
  ['🍺', 'beer', 'ipa', 'lager', 'ale', 'pint', 'stout', 'guinness'],
  ['🍷', 'wine', 'merlot', 'cabernet', 'chardonnay', 'pinot', 'rose wine', 'sangria'],
  ['🍾', 'champagne', 'prosecco'],
  ['🍸', 'cocktail', 'martini', 'margarita', 'mojito', 'negroni', 'spritz', 'daiquiri'],
  ['🥃', 'whiskey', 'whisky', 'vodka', 'gin', 'rum', 'tequila', 'bourbon', 'scotch'],
  ['🍶', 'sake', 'soju'],

  // ── Breakfast ─────────────────────────────────────────────────────────────
  ['🍳', 'egg', 'omelette', 'omelet', 'scrambled egg', 'fried egg', 'egg white', 'frittata', 'shakshuka'],
  ['🥓', 'bacon', 'pancetta'],
  ['🌭', 'hot dog', 'hotdog', 'sausage', 'bratwurst', 'chorizo', 'frankfurter'],
  ['🥞', 'pancake', 'hotcake', 'crepe'],
  ['🧇', 'waffle'],
  ['🍞', 'bread', 'toast', 'sourdough', 'baguette', 'roll', 'bun', 'brioche', 'rye', 'french toast'],
  ['🥯', 'bagel'],
  ['🥐', 'croissant', 'pastry', 'danish', 'scone'],
  ['🥣', 'cereal', 'oatmeal', 'oats', 'porridge', 'granola', 'muesli', 'overnight oats', 'cream of rice', 'weetabix', 'grits', 'corn flakes', 'yogurt', 'yoghurt', 'skyr', 'greek yogurt', 'cottage cheese'],
  ['🍯', 'honey', 'syrup', 'maple syrup', 'jam', 'jelly', 'marmalade', 'agave'],
  ['🥜', 'peanut butter', 'almond butter', 'nut butter', 'nuts', 'almond', 'cashew', 'walnut', 'pistachio', 'pecan', 'peanut', 'macadamia', 'trail mix', 'hazelnut', 'tahini'],

  // ── Mains: meat + seafood ─────────────────────────────────────────────────
  ['🍗', 'chicken', 'chicken breast', 'chicken thigh', 'nugget', 'wings', 'rotisserie', 'drumstick', 'kfc'],
  ['🦃', 'turkey'],
  ['🥩', 'steak', 'beef', 'ribeye', 'sirloin', 'filet', 'brisket', 'ground beef', 'mince', 'jerky', 'biltong', 'carne asada'],
  ['🍖', 'pork', 'ham', 'ribs', 'pork chop', 'tenderloin', 'lamb', 'mutton', 'meat', 'venison', 'prosciutto', 'salami', 'salame', 'deli meat', 'charcuterie'],
  ['🍔', 'burger', 'cheeseburger', 'hamburger', 'smash burger', 'patty', 'mcdonald', 'five guys', 'in n out', 'shake shack', 'whopper', 'big mac'],
  ['🐟', 'fish', 'salmon', 'tuna', 'cod', 'tilapia', 'halibut', 'mackerel', 'sardine', 'trout', 'sea bass', 'anchovy'],
  ['🍤', 'shrimp', 'prawn', 'tempura'],
  ['🍣', 'sushi', 'sashimi', 'nigiri', 'maki', 'poke', 'poke bowl', 'sushi roll', 'california roll'],
  ['🍙', 'onigiri', 'rice ball', 'musubi'],
  ['🦞', 'lobster', 'crab', 'crawfish'],
  ['🦪', 'oyster', 'mussel', 'clam', 'scallop'],
  ['🦑', 'squid', 'calamari', 'octopus'],
  ['🫘', 'beans', 'lentil', 'chickpea', 'hummus', 'black beans', 'refried beans', 'tofu', 'tempeh', 'seitan'],
  ['🫛', 'edamame', 'peas', 'snap peas', 'green beans'],

  // ── Mains: dishes ─────────────────────────────────────────────────────────
  ['🍕', 'pizza', 'calzone', 'domino', 'pepperoni'],
  ['🍝', 'pasta', 'spaghetti', 'penne', 'linguine', 'fettuccine', 'carbonara', 'bolognese', 'lasagna', 'mac and cheese', 'macaroni', 'ravioli', 'gnocchi', 'orzo'],
  ['🍜', 'ramen', 'pho', 'noodle', 'udon', 'soba', 'lo mein', 'chow mein', 'pad thai'],
  ['🍚', 'rice', 'fried rice', 'jasmine rice', 'basmati', 'risotto', 'biryani', 'quinoa', 'couscous', 'rice bowl'],
  ['🌯', 'burrito', 'wrap', 'quesadilla', 'chipotle', 'chimichanga'],
  ['🌮', 'taco', 'nachos', 'tortilla chips', 'taco bell'],
  ['🥪', 'sandwich', 'sub', 'panini', 'blt', 'club sandwich', 'subway', 'panera', 'grilled cheese'],
  ['🥗', 'salad', 'caesar salad', 'greens', 'coleslaw', 'sweetgreen', 'chicken salad', 'cobb'],
  ['🍲', 'soup', 'stew', 'chili', 'broth', 'bisque', 'chowder', 'casserole', 'hotpot'],
  ['🍛', 'curry', 'tikka masala', 'butter chicken', 'katsu', 'dal'],
  ['🥟', 'dumpling', 'gyoza', 'potsticker', 'wonton', 'bao', 'empanada', 'pierogi', 'samosa', 'egg roll', 'spring roll'],
  ['🍟', 'fries', 'french fries', 'hash brown', 'tots', 'tater tots'],
  ['🥔', 'potato', 'mashed potato', 'baked potato', 'sweet potato', 'yam', 'chips', 'crisps', 'doritos', 'pringles', 'cheetos'],
  ['🥨', 'pretzel'],
  ['🫓', 'tortilla', 'pita', 'naan', 'flatbread', 'roti', 'arepa'],
  ['🥙', 'kebab', 'shawarma', 'gyro', 'souvlaki', 'skewer', 'wrap sandwich'],
  ['🧆', 'falafel', 'meatball'],
  ['🥧', 'pie', 'quiche', 'pot pie', 'shepherds pie'],
  ['🍿', 'popcorn'],
  ['🍱', 'bento', 'meal prep', 'leftovers', 'plate'],
  ['🍘', 'crackers', 'rice cake', 'ritz', 'wasa'],
  ['🍡', 'mochi', 'dango'],

  // ── Produce ───────────────────────────────────────────────────────────────
  ['🥦', 'broccoli', 'cauliflower', 'brussels sprouts', 'asparagus'],
  ['🥕', 'carrot'],
  ['🥑', 'avocado', 'guacamole'],
  ['🍅', 'tomato', 'marinara', 'salsa', 'ketchup', 'pico de gallo'],
  ['🥒', 'cucumber', 'pickle', 'zucchini', 'courgette'],
  ['🌶️', 'pepper', 'bell pepper', 'jalapeno', 'chili pepper', 'sriracha', 'hot sauce', 'paprika'],
  ['🧅', 'onion', 'shallot', 'leek', 'scallion'],
  ['🧄', 'garlic'],
  ['🍄', 'mushroom', 'portobello', 'shiitake'],
  ['🥬', 'spinach', 'kale', 'lettuce', 'arugula', 'cabbage', 'bok choy', 'chard'],
  ['🍆', 'eggplant', 'aubergine'],
  ['🎃', 'pumpkin', 'squash', 'butternut'],
  ['🌽', 'corn', 'corn on the cob'],
  ['🫒', 'olive', 'olive oil', 'oil'],
  ['🍌', 'banana', 'plantain'],
  ['🍎', 'apple'],
  ['🍊', 'orange', 'mandarin', 'clementine', 'tangerine'],
  ['🍓', 'strawberry'],
  ['🫐', 'blueberry', 'blackberry', 'raspberry', 'berry', 'acai'],
  ['🍇', 'grape', 'raisin'],
  ['🍉', 'watermelon'],
  ['🍈', 'melon', 'cantaloupe', 'honeydew'],
  ['🍍', 'pineapple'],
  ['🥭', 'mango'],
  ['🍑', 'peach', 'nectarine', 'apricot'],
  ['🍐', 'pear'],
  ['🍒', 'cherry'],
  ['🥝', 'kiwi'],
  ['🍋', 'lemon', 'lime'],
  ['🥥', 'coconut'],
  ['🌰', 'chestnut', 'date', 'fig', 'prune'],

  // ── Dairy + fats ──────────────────────────────────────────────────────────
  ['🧀', 'cheese', 'cheddar', 'mozzarella', 'parmesan', 'feta', 'brie', 'gouda', 'halloumi', 'queso'],
  ['🧈', 'butter', 'ghee', 'margarine'],

  // ── Sweets + snacks ───────────────────────────────────────────────────────
  ['🍫', 'chocolate', 'dark chocolate', 'kitkat', 'snickers', 'reese', 'brownie', 'nutella', 'protein bar', 'granola bar', 'quest bar', 'rx bar', 'clif bar', 'twix'],
  ['🍬', 'candy', 'gummy', 'haribo', 'skittles', 'sour patch', 'lollipop', 'starburst'],
  ['🍪', 'cookie', 'biscuit', 'oreo', 'shortbread'],
  ['🍰', 'cake', 'cheesecake', 'birthday cake', 'tart'],
  ['🧁', 'cupcake', 'muffin'],
  ['🍩', 'donut', 'doughnut'],
  ['🍦', 'ice cream', 'gelato', 'sorbet', 'froyo', 'frozen yogurt', 'popsicle', 'sundae'],
  ['🍮', 'pudding', 'custard', 'flan', 'mousse', 'tiramisu'],

  // ── Pantry + supplements ──────────────────────────────────────────────────
  ['💊', 'vitamin', 'supplement', 'creatine', 'pill', 'capsule', 'magnesium', 'omega', 'fish oil', 'multivitamin', 'zinc', 'ashwagandha'],
  ['🧂', 'salt', 'seasoning', 'spice'],
  ['🥫', 'sauce', 'dressing', 'mayo', 'mustard', 'soy sauce', 'gravy', 'canned', 'pesto'],
]

// Fallbacks when nothing in the table matches, keyed by how it was logged.
const SOURCE_FALLBACK: Record<string, string> = {
  drink: '🥤',
  barcode: '🥫',
  photo: '🍽️',
  meal: '🍽️',
  text: '🍽️',
}

function singular(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return token.slice(0, -3) + 'y'
  if (token.length > 3 && /(ch|sh|s|x|z|o)es$/.test(token)) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singular)
}

// "Onigiri with bonito flakes" / "Salmon, rice and broccoli" → the head phrase.
const BOUNDARY = new Set(['with', 'and', 'plus', 'w', 'side', 'topped', 'served', 'over', 'on'])
function headTokens(name: string): string[] {
  const tokens = tokenize(name.split(/[,(/;+]/)[0])
  const cut = tokens.findIndex(t => BOUNDARY.has(t))
  return cut > 0 ? tokens.slice(0, cut) : tokens
}

interface Phrase {
  emoji: string
  tokens: string[]
}

const PHRASES: Phrase[] = RULES.flatMap(([emoji, ...words]) =>
  words.map(word => ({ emoji, tokens: tokenize(word) })),
)

function matchTokens(tokens: string[]): string | null {
  let best: { emoji: string; end: number; len: number } | null = null
  for (const phrase of PHRASES) {
    const n = phrase.tokens.length
    for (let i = 0; i + n <= tokens.length; i++) {
      let hit = true
      for (let j = 0; j < n; j++) {
        if (tokens[i + j] !== phrase.tokens[j]) { hit = false; break }
      }
      if (!hit) continue
      const end = i + n - 1
      // Head-final: latest-ending match wins; longer phrase breaks the tie.
      if (!best || end > best.end || (end === best.end && n > best.len)) {
        best = { emoji: phrase.emoji, end, len: n }
      }
    }
  }
  return best?.emoji ?? null
}

/**
 * Resolve the emoji for a food entry. `override` (the user's saved choice) wins;
 * otherwise the name is matched against the keyword table, then the source.
 */
export function foodEmoji(
  name: string,
  opts: { source?: string | null; override?: string | null; isDrink?: boolean } = {},
): string {
  if (opts.override) return opts.override

  const matched = matchTokens(headTokens(name ?? '')) ?? matchTokens(tokenize(name ?? ''))
  if (matched) return matched

  if (opts.isDrink) return '🥤'
  return SOURCE_FALLBACK[opts.source ?? ''] ?? '🍽️'
}

/** Auto-assigned emoji only — used to show "Auto" state in the picker. */
export function autoFoodEmoji(name: string, source?: string | null): string {
  return foodEmoji(name, { source })
}

// Grid shown in the per-entry emoji picker (customisation). Any emoji can be
// typed in as well; these are just the fast taps.
export const EMOJI_CHOICES: string[] = [
  '🍽️', '🥤', '💧', '☕', '🍵', '🥛', '🧃', '🍺', '🍷', '⚡',
  '🍳', '🥓', '🥞', '🧇', '🍞', '🥯', '🥐', '🥣', '🍯', '🥜',
  '🍗', '🥩', '🍖', '🍔', '🌭', '🐟', '🍤', '🍣', '🍙', '🫘',
  '🍕', '🍝', '🍜', '🍚', '🌯', '🌮', '🥪', '🥗', '🍲', '🍛',
  '🥟', '🍟', '🥔', '🥨', '🫓', '🥙', '🧆', '🥧', '🍿', '🍱',
  '🥦', '🥕', '🥑', '🍅', '🥒', '🌶️', '🍄', '🥬', '🌽', '🧀',
  '🍌', '🍎', '🍊', '🍓', '🫐', '🍇', '🍉', '🍍', '🥭', '🍑',
  '🍫', '🍬', '🍪', '🍰', '🧁', '🍩', '🍦', '🍮', '💊', '🥫',
]
