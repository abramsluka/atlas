import { FACT_CATEGORIES } from './types'

// Shared between the live extractor, the consolidation pass, and the one-off
// seed script so all three obey the same rules about what a fact is.
export const FACT_RULES = `WHAT COUNTS AS A FACT:
- Extract only what the user actually stated or clearly implied. Never infer, estimate, score, rate, or grade anything. Do not write things like "recovery capacity around 8.5/10" or "his sleep is elite" — those are judgments you invented, not facts he told you.
- One fact per entry, one sentence, third person, self-contained. If a fact only makes sense sitting next to another fact, it is either two facts or none.
- Never record a measured number or a specific date. This is the rule most often broken, so apply it strictly. Lifted weights and reps, sleep durations, HRV, resting heart rate, readiness scores, calories and protein actually eaten, body weight readings: all of these are already in the database, and a copy here would be stale within weeks while still being stated as current. The same goes for anything anchored to a date ("has skipped push day since June 17").
- When a sentence like that contains a real underlying pattern, keep the pattern and drop the measurements. "Ate 1,900 kcal one day and almost nothing the next" becomes "His daily food intake swings between full days and days he barely eats." "Benched 185 for 8" becomes nothing at all. A configured target he chose (a daily protein goal, a target body weight) is durable and may keep its number.
- Skip anything transient and trivial (what he ate, whether today went fine). A profile fact should still be worth knowing in three months, or it belongs in the state tier.
- Tier. Default to durable. A fact is durable if it would still be worth knowing in three months: life events, commitments, relationships, habits, jobs, moves, preferences, goals, recurring struggles. A thing that happened recently is still durable if its effect persists. "Started taking guitar lessons" and "His sister moved back to the city" are both durable, even though both are recent and the entry said "recently".
- A fact is state ONLY if it is about how he is doing lately rather than what is true about his life: current mood, stress, energy, motivation, what is weighing on him this week. The test is whether the sentence could stop being true in two weeks purely because his mood shifted. If yes, it is state. If it would take an actual life change to falsify it, it is durable.
- Write plainly. No therapy-speak, no motivational framing, no hedging like "seems to" or "appears to".
- If there is nothing worth remembering, return empty arrays. Short or logistical entries usually have nothing.

CATEGORIES: ${FACT_CATEGORIES.join(', ')}`

export const CATEGORY_ENUM = [...FACT_CATEGORIES]
