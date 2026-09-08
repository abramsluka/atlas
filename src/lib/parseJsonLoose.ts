// Parse a JSON object out of model output that may be wrapped in markdown.
//
// Prompts across Atlas say "return ONLY valid JSON", which Claude honors. Gemini
// (and sometimes GPT) still wraps the object in ```json fences, and a bare
// JSON.parse on that throws — which in routes with silent fallbacks means the
// user quietly gets the default value instead of a real answer. Since users can
// now pick their provider, parsing has to tolerate all three.
//
// Returns null when nothing parseable is found, so callers keep their existing
// fallback behavior.
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  const text = (raw ?? '').trim()
  if (!text) return null

  // Straight parse first — the common, well-behaved case.
  try {
    return JSON.parse(text) as T
  } catch {
    // fall through
  }

  // Strip a ```json … ``` (or bare ``` … ```) fence.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]) as T
    } catch {
      // fall through
    }
  }

  // Last resort: the first {...} or [...] span in the text.
  const span = text.match(/[{[][\s\S]*[}\]]/)
  if (span?.[0]) {
    try {
      return JSON.parse(span[0]) as T
    } catch {
      // fall through
    }
  }

  return null
}
