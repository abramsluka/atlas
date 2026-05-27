import type { TimeSlot } from './types'

export interface SupplementDbEntry {
  name: string
  dose: string
  window: TimeSlot
  note: string
  icon: string
  aliases: string[]
}

export interface StackWindow {
  key: TimeSlot
  icon: string
  title: string
  time: string
  cutoffHour: number | null
}

export const STACK_WINDOWS: StackWindow[] = [
  { key: 'morning', icon: '🌅', title: 'Morning', time: '7–10 AM', cutoffHour: 10 },
  { key: 'lunch',   icon: '🍽️', title: 'Lunch',   time: '12–2 PM', cutoffHour: 14 },
  { key: 'evening', icon: '🌙', title: 'Evening', time: '9–11 PM', cutoffHour: 23 },
  { key: 'anytime', icon: '⏱️', title: 'Anytime', time: 'No fixed window', cutoffHour: null },
]

export const SUPPLEMENT_DB: SupplementDbEntry[] = [
  { name: 'Creatine monohydrate', dose: '5g', window: 'anytime', note: 'Daily — consistency matters more than timing', icon: '🏋️', aliases: ['creatine'] },
  { name: 'Beta-alanine', dose: '2–5g', window: 'morning', note: 'Pre-workout — split doses to avoid tingles', icon: '🏋️', aliases: ['beta alanine'] },
  { name: 'L-citrulline', dose: '6–8g', window: 'morning', note: '~30 min pre-workout for pump', icon: '🏋️', aliases: ['citrulline'] },
  { name: 'BCAAs', dose: '5–10g', window: 'anytime', note: 'Around workout window', icon: '🏋️', aliases: ['bcaa'] },
  { name: 'Whey protein', dose: '25–40g', window: 'anytime', note: 'Post-workout or to hit daily target', icon: '🥤', aliases: ['whey'] },
  { name: 'Casein protein', dose: '25–40g', window: 'evening', note: 'Before bed for slow overnight aminos', icon: '🥤', aliases: ['casein'] },
  { name: 'L-carnitine', dose: '1–2g', window: 'morning', note: 'With carbs for best uptake', icon: '🏋️', aliases: ['carnitine'] },
  { name: 'Acetyl-L-carnitine', dose: '500mg–2g', window: 'morning', note: 'Cognitive variant — crosses BBB', icon: '🧠', aliases: ['alcar'] },
  { name: 'HMB', dose: '3g', window: 'anytime', note: 'Split 3x daily — muscle preservation', icon: '🏋️', aliases: ['hmb'] },
  { name: 'Glutamine', dose: '5g', window: 'anytime', note: 'Recovery — post-workout or before bed', icon: '🏋️', aliases: ['l-glutamine'] },
  { name: 'Vitamin D3', dose: '2000–5000 IU', window: 'lunch', note: 'Fat-soluble — take with biggest meal', icon: '☀️', aliases: ['vit d', 'vitamin d', 'd3', 'cholecalciferol'] },
  { name: 'Vitamin K2 (MK-7)', dose: '100–200 mcg', window: 'lunch', note: 'Pairs with D3 — same meal', icon: '💊', aliases: ['vit k', 'vitamin k', 'k2', 'mk7'] },
  { name: 'Vitamin C', dose: '500–1000mg', window: 'morning', note: 'Water-soluble — split if over 500mg', icon: '🍊', aliases: ['vit c', 'ascorbic acid'] },
  { name: 'Vitamin B12', dose: '500–1000mcg', window: 'morning', note: 'Methylcobalamin form preferred', icon: '⚡', aliases: ['b12', 'methylcobalamin'] },
  { name: 'B-complex', dose: '1 cap', window: 'morning', note: 'All B vitamins — energy', icon: '⚡', aliases: ['b complex', 'b vitamins'] },
  { name: 'Vitamin A', dose: '5000 IU', window: 'lunch', note: 'Fat-soluble — with fat', icon: '💊', aliases: ['vit a', 'retinol'] },
  { name: 'Vitamin E', dose: '400 IU', window: 'lunch', note: 'Fat-soluble — with fat', icon: '💊', aliases: ['vit e', 'tocopherol'] },
  { name: 'Folate', dose: '400–800mcg', window: 'morning', note: 'Methylfolate preferred', icon: '💊', aliases: ['folic acid', 'b9', 'methylfolate'] },
  { name: 'Biotin', dose: '30mcg–5mg', window: 'anytime', note: 'Hair, skin, nails', icon: '💅', aliases: ['biotin', 'b7'] },
  { name: 'Multivitamin', dose: '1 serving', window: 'lunch', note: 'Take with food', icon: '💊', aliases: ['multi', 'multivitamin'] },
  { name: 'Magnesium glycinate', dose: '200–400mg', window: 'evening', note: '30–60 min before bed — sleep helper', icon: '🌙', aliases: ['magnesium', 'mag glycinate', 'bisglycinate'] },
  { name: 'Magnesium L-threonate', dose: '144mg elemental', window: 'evening', note: 'Cognitive variant — crosses BBB', icon: '🧠', aliases: ['magtein', 'threonate'] },
  { name: 'Magnesium citrate', dose: '200–400mg', window: 'evening', note: 'Also supports digestion', icon: '🌙', aliases: ['mag citrate'] },
  { name: 'Zinc', dose: '15–30mg', window: 'evening', note: 'With food — not with calcium or iron', icon: '💊', aliases: ['zinc'] },
  { name: 'Iron', dose: '18–65mg', window: 'morning', note: 'Empty stomach with vit C', icon: '💊', aliases: ['iron'] },
  { name: 'Calcium', dose: '500mg', window: 'evening', note: 'With food — not with iron', icon: '🦴', aliases: ['calcium'] },
  { name: 'Selenium', dose: '100–200mcg', window: 'anytime', note: 'Thyroid + antioxidant', icon: '💊', aliases: ['selenium'] },
  { name: 'Iodine', dose: '150mcg', window: 'morning', note: 'Thyroid support', icon: '💊', aliases: ['iodine'] },
  { name: 'Omega-3 (Fish oil)', dose: '2–3g EPA+DHA', window: 'lunch', note: 'With biggest fatty meal', icon: '🐟', aliases: ['omega 3', 'omega3', 'fish oil', 'epa', 'dha'] },
  { name: 'Krill oil', dose: '500–1000mg', window: 'lunch', note: 'More absorbable than fish oil', icon: '🐟', aliases: ['krill'] },
  { name: 'MCT oil', dose: '1–2 tbsp', window: 'morning', note: 'Fast energy — start low', icon: '🥥', aliases: ['mct'] },
  { name: 'Flaxseed oil', dose: '1–2g', window: 'lunch', note: 'Plant omega-3 — with food', icon: '🌱', aliases: ['flax', 'flaxseed'] },
  { name: 'L-theanine', dose: '100–200mg', window: 'morning', note: 'Stacks with caffeine 2:1', icon: '🧠', aliases: ['theanine'] },
  { name: 'Caffeine', dose: '100–200mg', window: 'morning', note: 'Stack with L-theanine for cleaner focus', icon: '☕', aliases: ['caffeine'] },
  { name: 'Rhodiola rosea', dose: '200–400mg', window: 'morning', note: 'Adaptogen — energy and stress', icon: '🌿', aliases: ['rhodiola'] },
  { name: "Lion's mane", dose: '500–1000mg', window: 'morning', note: 'Cognitive support — daily', icon: '🍄', aliases: ['lions mane', 'hericium'] },
  { name: 'Bacopa monnieri', dose: '300–600mg', window: 'morning', note: 'With fat — long-term memory', icon: '🌿', aliases: ['bacopa'] },
  { name: 'Ginkgo biloba', dose: '120–240mg', window: 'morning', note: 'Circulation and cognition', icon: '🌿', aliases: ['ginkgo'] },
  { name: 'Alpha-GPC', dose: '300–600mg', window: 'morning', note: 'Choline — focus and learning', icon: '🧠', aliases: ['alpha gpc'] },
  { name: 'Phosphatidylserine', dose: '100–300mg', window: 'evening', note: 'Cortisol regulation', icon: '🧠', aliases: ['ps'] },
  { name: 'NAC', dose: '600–1800mg', window: 'morning', note: 'Glutathione precursor — split doses', icon: '💊', aliases: ['nac', 'n-acetyl cysteine'] },
  { name: 'Melatonin', dose: '0.3–3mg', window: 'evening', note: '30–60 min before bed — start low', icon: '🌙', aliases: ['melatonin'] },
  { name: 'Glycine', dose: '3g', window: 'evening', note: 'Body temp drop = better sleep onset', icon: '🌙', aliases: ['glycine'] },
  { name: 'Apigenin', dose: '50mg', window: 'evening', note: 'From chamomile — before bed', icon: '🌙', aliases: ['apigenin'] },
  { name: 'Ashwagandha', dose: '300–600mg', window: 'evening', note: 'KSM-66 form — stress and cortisol', icon: '🌿', aliases: ['ashwagandha', 'ksm-66'] },
  { name: 'L-tryptophan', dose: '500mg–1g', window: 'evening', note: 'Serotonin precursor — sleep onset', icon: '🌙', aliases: ['tryptophan'] },
  { name: 'GABA', dose: '500–750mg', window: 'evening', note: 'Calming — before bed', icon: '🌙', aliases: ['gaba'] },
  { name: 'Valerian root', dose: '300–600mg', window: 'evening', note: 'Sleep onset support', icon: '🌙', aliases: ['valerian'] },
  { name: 'Probiotics', dose: '10–50 billion CFU', window: 'morning', note: 'Empty stomach or with food', icon: '🦠', aliases: ['probiotic'] },
  { name: 'Quercetin', dose: '500–1000mg', window: 'anytime', note: 'Pairs well with vitamin C', icon: '🌿', aliases: ['quercetin'] },
  { name: 'Curcumin', dose: '500–1000mg', window: 'lunch', note: 'With black pepper + fat', icon: '🌿', aliases: ['curcumin', 'turmeric'] },
  { name: 'Resveratrol', dose: '250–500mg', window: 'morning', note: 'With fat for absorption', icon: '🍇', aliases: ['resveratrol'] },
  { name: 'CoQ10 / Ubiquinol', dose: '100–200mg', window: 'lunch', note: 'Fat-soluble — with biggest meal', icon: '💊', aliases: ['coq10', 'ubiquinol'] },
  { name: 'Alpha lipoic acid', dose: '300–600mg', window: 'morning', note: 'Empty stomach for absorption', icon: '💊', aliases: ['ala', 'alpha lipoic'] },
  { name: 'Glutathione', dose: '250–1000mg', window: 'morning', note: 'Liposomal form for absorption', icon: '💊', aliases: ['glutathione'] },
  { name: 'Astaxanthin', dose: '4–12mg', window: 'lunch', note: 'Fat-soluble — with fatty meal', icon: '💊', aliases: ['astaxanthin'] },
  { name: 'Berberine', dose: '500mg', window: 'lunch', note: 'Before meals — glucose support', icon: '💊', aliases: ['berberine'] },
  { name: 'Milk thistle', dose: '200–400mg', window: 'anytime', note: 'Silymarin — liver support', icon: '🌿', aliases: ['milk thistle', 'silymarin'] },
  { name: 'Spirulina', dose: '3–5g', window: 'morning', note: 'Algae — protein and antioxidants', icon: '🌱', aliases: ['spirulina'] },
  { name: 'Chlorella', dose: '2–4g', window: 'morning', note: 'Algae — detox support', icon: '🌱', aliases: ['chlorella'] },
  { name: 'Tongkat ali', dose: '200–400mg', window: 'morning', note: 'Cycle 8 weeks on/off', icon: '🌿', aliases: ['tongkat', 'longjack'] },
  { name: 'Fadogia agrestis', dose: '600mg', window: 'morning', note: 'Cycle 8 weeks on/off', icon: '🌿', aliases: ['fadogia'] },
  { name: 'DHEA', dose: '25–50mg', window: 'morning', note: 'Hormonal — consult doctor', icon: '💊', aliases: ['dhea'] },
  { name: 'Pregnenolone', dose: '10–50mg', window: 'morning', note: 'Hormonal — consult doctor', icon: '💊', aliases: ['pregnenolone'] },
  { name: 'Tribulus terrestris', dose: '250–750mg', window: 'morning', note: 'Libido and energy', icon: '🌿', aliases: ['tribulus'] },
  { name: 'Maca root', dose: '1.5–3g', window: 'morning', note: 'Adaptogen — energy and libido', icon: '🌿', aliases: ['maca'] },
  { name: 'Collagen peptides', dose: '10–20g', window: 'anytime', note: 'With vitamin C for synthesis', icon: '💅', aliases: ['collagen'] },
  { name: 'Glucosamine', dose: '1500mg', window: 'lunch', note: 'With food', icon: '🦴', aliases: ['glucosamine'] },
  { name: 'Chondroitin', dose: '1200mg', window: 'lunch', note: 'Often paired with glucosamine', icon: '🦴', aliases: ['chondroitin'] },
  { name: 'MSM', dose: '1–3g', window: 'anytime', note: 'Joint support', icon: '🦴', aliases: ['msm'] },
  { name: 'Hyaluronic acid', dose: '120–200mg', window: 'anytime', note: 'Skin and joint hydration', icon: '💅', aliases: ['hyaluronic', 'ha'] },
  { name: 'Cordyceps', dose: '1–3g', window: 'morning', note: 'Energy and endurance', icon: '🍄', aliases: ['cordyceps'] },
  { name: 'Reishi', dose: '1–2g', window: 'evening', note: 'Calming adaptogen', icon: '🍄', aliases: ['reishi', 'ganoderma'] },
  { name: 'Chaga', dose: '1–2g', window: 'morning', note: 'Antioxidant and immune', icon: '🍄', aliases: ['chaga'] },
]

export function searchSupplements(q: string): SupplementDbEntry[] {
  const query = q.toLowerCase().trim()
  if (!query) return []
  const starts: SupplementDbEntry[] = []
  const contains: SupplementDbEntry[] = []
  SUPPLEMENT_DB.forEach(s => {
    const nameLC = s.name.toLowerCase()
    const allNames = [nameLC, ...s.aliases.map(a => a.toLowerCase())]
    if (allNames.some(n => n.startsWith(query))) starts.push(s)
    else if (allNames.some(n => n.includes(query))) contains.push(s)
  })
  return [...starts, ...contains].slice(0, 6)
}
