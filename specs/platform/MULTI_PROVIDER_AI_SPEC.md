# Multi-Provider AI Spec (Claude / GPT / Gemini)

Status: proposed (not yet built)
Area: Platform (BYOK, AI routing)
Author: Claude session, 2026-09-07

## Goal

Let each user bring whichever AI provider they already pay for, and choose which
provider handles which kind of work, instead of Atlas hard-requiring an
Anthropic key for everything.

## Why this is worth doing (the real reason)

The headline feature sounds like per-feature flexibility. The bigger practical
win is **onboarding cost**:

- Today a new user cannot use a single AI feature without an Anthropic account,
  a credit card, and prepaid credits.
- **Gemini has a genuinely free tier.** Adding it turns "get a credit card and
  buy credits" into "grab a free Google API key," which is the single biggest
  drop-off point in the invite flow.

Per-category choice is the nice-to-have. Free-tier access is the thing that
actually changes who can use Atlas.

---

## The constraint that shapes everything

**The three providers are not interchangeable.** Atlas's ~27 AI call sites split
into capability buckets, and the buckets have different portability:

| Bucket | Files | Portability |
|---|---|---|
| Plain streaming text (coaches, briefing, journal reflect/reply) | ~10 | **Easy.** All three stream text. |
| One-shot text (titles, summaries, chips, suggestions) | ~17 | **Easy.** |
| Vision / image input (food photo, debloat, receipt import, exercise library) | 6 | **Medium.** All three do vision, different image encodings. |
| Structured JSON output (journal plan) | 1 | **Medium.** Anthropic `output_config.format`, OpenAI `response_format`, Gemini `responseSchema` — same idea, three shapes. |
| **Multi-turn tool use** (mentor chat, assistant chat, program generate, receipt import, chips) | 5 | **Hard.** This is the real work. Anthropic `tool_use`/`tool_result` blocks, OpenAI function calling, and Gemini function declarations differ substantially, and the assistant runs a multi-turn loop over them. |
| **Audio transcription** (voice notes, journal audio) | 2 | **Claude cannot do this at all.** Anthropic has no audio API. This bucket is OpenAI or Gemini only, permanently. |

Two consequences that must be reflected in the UI, not hidden:

1. **Transcription can never offer Claude.** Any "pick your model" UI that lists
   Claude for voice is lying.
2. **Prompt quality is not portable.** Every prompt in Atlas was written and
   tuned against Claude. The same prompt on GPT or Gemini will behave
   differently, sometimes worse, especially the long context-stuffed mentor
   prompt. This is a real product cost, not a bug to fix later.

---

## Recommended shape: three categories, not fifteen features

Per-feature dropdowns (fifteen-plus knobs) multiply the testing surface by three
and almost nobody will touch them. Per-category matches how people actually
think and maps cleanly onto the capability buckets above.

**Settings shows three choices:**

| Category | Covers | Providers offered | Default |
|---|---|---|---|
| **Coaching & chat** | mentor, gym/health/food coaches, briefing, journal reflection, titles | Claude, GPT, Gemini | Claude |
| **Photos & analysis** | food photos, debloat, receipt import, structured extraction | Claude, GPT, Gemini | GPT |
| **Voice** | voice notes, journal audio transcription | GPT, Gemini **(no Claude)** | GPT |

Each row shows a short "what this does" line, which providers the user has a key
for (greyed out otherwise), and a recommendation badge. Choosing a provider the
user has no key for prompts for the key inline.

Storage: `user_settings.ai_prefs jsonb`, shaped
`{"coaching":"anthropic","analysis":"openai","voice":"openai"}`. Absent keys
fall back to the defaults above, then to whatever provider the user actually has
a key for.

---

## Implementation approach

### Use the Vercel AI SDK, do not hand-roll adapters

Writing our own three-way adapter for streaming, tool loops, and structured
output is building a small LLM abstraction library and maintaining it forever.
The `ai` package (with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`)
already does exactly this, is built for the Next.js App Router, and covers
`streamText`, `generateObject`, and unified tool calling.

Honest tradeoffs:
- It is a real migration of ~27 call sites.
- Its tool abstraction will not map 1:1 onto the existing assistant loop, which
  is hand-written around Anthropic block shapes.
- Anthropic-specific knobs (adaptive thinking, effort) are not uniformly exposed,
  so any route relying on them needs checking.

### Resolution helper

One function replaces the current `getAnthropicForUser` / `getOpenAIForUser` at
every call site:

```ts
getModelForFeature(userId, category: 'coaching' | 'analysis' | 'voice')
  -> { provider, model, client } | { error: 'no_key', providersUserHas: [...] }
```

It reads `ai_prefs`, falls back sensibly, verifies the user actually has that
provider's key in `user_secrets`, and returns a ready model handle. The existing
`428 no_api_key` contract stays, but the error payload gains which providers
would work, so the UI can say "you picked Gemini but have no Gemini key."

### Model choice within a provider

Keep it opinionated. Users pick a *provider*, Atlas picks the model (a fast one
for background work, a strong one for user-facing coaching), exactly as it does
today with Sonnet vs Haiku. Exposing raw model IDs invites people to select
something that cannot do vision or tools and then file a bug.

---

## Phasing (each phase ships independently)

**Phase 1 — Gemini key + free-tier onboarding.** Add `gemini_api_key_enc` to
`user_secrets`, add the Settings card, and migrate only the *easy* buckets
(plain streaming text and one-shot text) to the AI SDK behind a single
"Coaching & chat" preference. Tool-using and vision routes stay Claude-only and
are labeled as such. **This alone delivers the free-tier win.**

**Phase 2 — Vision + structured output.** Migrate the 6 vision routes and the 1
structured-output route; enable the "Photos & analysis" category.

**Phase 3 — Voice.** Add Gemini transcription; enable the "Voice" category. Small.

**Phase 4 — Tool use.** Port mentor chat, assistant chat, program generate,
receipt import, and chips. This is the largest and riskiest phase; it should be
last and can be skipped indefinitely with those features pinned to Claude.

---

## Data model

```sql
alter table user_secrets  add column if not exists gemini_api_key_enc text;
alter table user_settings add column if not exists ai_prefs jsonb;
```

No other schema changes. Key storage reuses the existing AES-256-GCM path in
`userKeys.ts`; `KeyProvider` widens to `'anthropic' | 'openai' | 'gemini'`.

---

## What Luka does on his end

1. **Get a Gemini key** at `aistudio.google.com` → "Get API key". Free tier needs
   no billing setup and no credit card.
2. **Update the invite message** so new people can pick the free option: "grab a
   free Google AI key" is a much lower bar than "buy Anthropic credits."
3. **Nothing in Vercel.** Provider keys are per-user in `user_secrets`, not env
   vars.
4. **Expect quality differences.** Prompts are Claude-tuned; a Gemini user will
   get noticeably different coaching voice. That is inherent, not a bug.

---

## Out of scope

- Letting users type raw model IDs.
- Per-individual-feature dropdowns (fifteen-plus knobs).
- Offering Claude for transcription (impossible).
- Re-tuning every prompt per provider. Prompts stay written for Claude; other
  providers get the same text.

## Acceptance criteria

- A user with **only** a Gemini key can complete signup and use coaching, with
  no Anthropic account anywhere.
- Settings never offers a provider the user has no key for without prompting for
  that key, and never offers Claude for voice.
- Switching a category's provider takes effect on the next request with no
  reload.
- A user with only an Anthropic key sees identical behavior to today.
- Typecheck and production build clean.

## Rough effort

Phase 1 is the valuable slice and is medium-sized (one dependency, one
migration, one Settings section, ~15 simple call sites). Phase 4 is larger than
Phases 1 through 3 combined and is genuinely optional.
