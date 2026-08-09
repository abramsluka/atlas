---
name: clarify
description: When Luka's request is genuinely ambiguous, ask structured clarifying questions BEFORE doing any work, using the AskUserQuestion tool (tappable option boxes) instead of guessing and building the wrong thing. Skip entirely when the prompt is detailed enough to act on. Use at the start of any task where multiple plausible readings of the prompt lead to noticeably different work.
---

# Clarify — ask before guessing, only when it matters

Luka gives tasks in plain English, often voice-dictated, sometimes imprecise.
The default is still: interpret intent, make a judgment call, build. But when a
prompt is genuinely ambiguous, building the wrong thing wastes far more time
than asking. This skill defines the threshold and the mechanics.

## The threshold — ask ONLY when both are true

1. The ambiguity is about **intent, scope, or architecture**: two reasonable
   developers reading the same prompt would build noticeably different things.
2. You **cannot resolve it yourself** from the codebase, the conversation,
   CLAUDE.md, CLAUDE_CODE_MEMORY.md, git history, or obvious convention.

Do NOT ask when:

- The prompt is long, detailed, or a spec. That detail is the answer. Build it,
  and make judgment calls on whatever small gaps remain.
- The gap is detail-level: naming, minor layout, copy, which helper to use,
  where a file goes. Decide, then mention the call you made in your summary.
- The answer is discoverable. Go look before you ask; a question whose answer
  is in the repo is noise.
- You already asked this session. Don't drip questions one at a time.

Smell test: if you're picking between flavors of the same feature, decide. If
you're picking between different features, ask.

## How to ask

- Use the **AskUserQuestion tool** — it renders tappable answer boxes, which is
  much faster for Luka than typing, especially on his phone.
- Ask **before any work starts**, batched into ONE call (it supports up to 4
  questions). No scattering questions through the task.
- Give 2–4 concrete, mutually exclusive options per question. Put your
  recommendation first, labeled "(Recommended)". Never offer an option you
  think is wrong; say so in its description instead.
- Ask about the decision, not implementation trivia. "Replace the old page or
  add a new one alongside it?" is a good question. "Should the function be
  async?" is not.
- If a question is truly open-ended (naming something, picking copy), ask in
  plain text instead of forcing fake options.

## After the answers

Restate the resolved plan in one or two sentences, then build straight through
without further pauses. If a NEW genuine fork appears mid-build that changes
the outcome, one more AskUserQuestion is fine. Otherwise make the call and
note it at the end.
