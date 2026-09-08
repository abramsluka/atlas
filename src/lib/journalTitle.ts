import { generateText } from 'ai'
import { getModelForFeature } from '@/lib/aiProvider'

const PROMPTS = {
  // Reflective entries: theme or feeling
  entry:
    'Generate a title for this journal entry: 2-5 words, plain language, capturing the main theme or feeling. Reply with the title only — no quotes, no punctuation at the end, no explanation.',
  // Morning day plans: name the day's focus areas, never a generic label
  plan:
    "Title this day plan by naming its 2-3 biggest themes. Hard limit: 5 words. Plain language, drawn from the actual tasks, no generic labels like Day Plan. Good examples: Atlas, errands, game with dad — or — Deep work and gym day. Reply with the title only, no quotes, no trailing punctuation.",
} as const

// Short title for untitled journal entries. Returns null on any failure — never
// block saves on this (including when the user has no AI key yet).
export async function generateTitle(
  userId: string,
  content: string,
  style: keyof typeof PROMPTS = 'entry'
): Promise<string | null> {
  try {
    const resolved = await getModelForFeature(userId, 'coaching', 'fast')
    if (!resolved) return null
    const { text } = await generateText({
      model: resolved.model,
      maxOutputTokens: 24,
      system: PROMPTS[style],
      messages: [{ role: 'user', content: content.slice(0, 4000) }],
    })
    const title = text ? text.trim().replace(/^["']|["']$/g, '') : null
    return title && title.length <= 80 ? title : null
  } catch (err) {
    console.error('[journal] title generation failed:', err)
    return null
  }
}
