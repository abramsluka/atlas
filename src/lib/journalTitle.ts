import Anthropic from '@anthropic-ai/sdk'

// Short title for untitled journal entries. Returns null on any failure — never block saves on this.
export async function generateTitle(content: string): Promise<string | null> {
  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 24,
      system: 'Generate a title for this journal entry: 2-5 words, plain language, capturing the main theme or feeling. Reply with the title only — no quotes, no punctuation at the end, no explanation.',
      messages: [{ role: 'user', content: content.slice(0, 4000) }],
    })
    const block = res.content[0]
    const title = block?.type === 'text' ? block.text.trim().replace(/^["']|["']$/g, '') : null
    return title && title.length <= 80 ? title : null
  } catch (err) {
    console.error('[journal] title generation failed:', err)
    return null
  }
}
