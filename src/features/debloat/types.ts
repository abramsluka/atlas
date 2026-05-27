export interface DebloatLog {
  id: string
  user_id: string
  date: string
  bloat_level: number | null
  checklist: Record<string, boolean>
  notes: string | null
  created_at: string
  updated_at: string
}

export interface DebloatData {
  todayLog: DebloatLog | null
  history: DebloatLog[]
}

export const CHECKLIST_ITEMS = [
  { key: 'drink_water',    label: 'Drink lots of water',    emoji: '💧' },
  { key: 'electrolytes',   label: 'Electrolytes',           emoji: '⚡' },
  { key: 'walk',           label: 'Walk after meals',       emoji: '🚶' },
  { key: 'face_massage',   label: 'Face massage',           emoji: '🤲' },
  { key: 'avoid_triggers', label: 'Avoided trigger foods',  emoji: '🚫' },
  { key: 'slow_eating',    label: 'Ate slowly / no straws', emoji: '🍽️' },
] as const

export const BLOAT_LEVELS = [
  { level: 1, emoji: '😊', label: 'Flat' },
  { level: 2, emoji: '🙂', label: 'Slight' },
  { level: 3, emoji: '😐', label: 'Moderate' },
  { level: 4, emoji: '😣', label: 'Bad' },
  { level: 5, emoji: '😖', label: 'Awful' },
] as const

export const GUIDE_SECTIONS = [
  {
    title: 'Morning Routine',
    emoji: '🌅',
    items: [
      'Warm water with lemon first thing — stimulates digestion before you eat anything.',
      'Abdominal massage for 5 minutes in a clockwise direction, following the path of your colon.',
      'Gua sha on your face and neck to stimulate lymphatic drainage.',
      'Light movement — a 10-minute walk or gentle yoga before breakfast.',
    ],
  },
  {
    title: 'Foods to Avoid',
    emoji: '🚫',
    items: [
      'High-sodium processed foods — sodium causes water retention and makes bloat worse.',
      'Carbonated drinks including sparkling water — the bubbles go straight into your gut.',
      'Cruciferous vegetables in large raw amounts (broccoli, cauliflower, cabbage) — eat them cooked.',
      'Sugar alcohols like sorbitol and xylitol found in sugar-free products — they ferment in your gut.',
      'Chewing gum — every chew swallows a tiny bit of air.',
      'Eating too fast — you inhale air with every bite you rush.',
    ],
  },
  {
    title: 'Foods that Help',
    emoji: '✅',
    items: [
      'Ginger — fresh in hot water or as tea. One of the strongest natural digestive aids.',
      'Peppermint tea — relaxes the muscles of the digestive tract.',
      'Fennel seeds — chew a pinch after meals or steep as tea.',
      'Cucumber and asparagus — natural diuretics that reduce water retention.',
      'Papaya — contains papain, an enzyme that breaks down proteins and eases digestion.',
      'Probiotic foods like yogurt, kefir, or kimchi — build the gut bacteria that prevent gas.',
    ],
  },
  {
    title: 'Techniques',
    emoji: '💆',
    items: [
      'Gua sha on your abdomen — use firm, slow strokes from your ribs down to your hips.',
      'Wind-relieving pose (legs to chest), seated twist, cat-cow, child\'s pose — all relieve trapped gas.',
      'Dry brushing toward your heart before showering — stimulates lymph flow throughout your body.',
      'Deep belly breathing for 5 minutes — activates the parasympathetic system and relaxes your gut.',
    ],
  },
  {
    title: 'Lifestyle',
    emoji: '🌿',
    items: [
      'Stop eating 3 hours before bed — lying down while digesting traps gas and causes reflux.',
      'Never use straws — every sip pulls extra air directly into your gut.',
      'Manage stress — cortisol disrupts digestion. Your gut and brain are directly wired together.',
      'Eat at a table away from your phone — mindless eating means faster eating means more air swallowed.',
      'Track what you ate when bloat spikes — your personal triggers matter more than any general rule.',
    ],
  },
] as const
