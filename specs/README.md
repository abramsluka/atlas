# Atlas Specs

Feature specs and implementation plans for Atlas, grouped by domain. These are planning docs —
the app doesn't read them at runtime. Operational docs (`CLAUDE.md`, `AGENTS.md`, `README.md`,
`CLAUDE_CODE_MEMORY.md`) stay at the repo root because tooling loads them.

Convention: one Markdown file per feature, named `<FEATURE>_SPEC.md`. A spec is written first,
iterated on, then implemented ("run the spec").

## gym/
- [EXERCISE_HISTORY_SPEC.md](gym/EXERCISE_HISTORY_SPEC.md) — exercise history pop-up (scrubbable progression chart, timeframe chooser, last-30-days, best), new-best celebration, next-target card, swap flow. **Planned, not built.**
- [EXERCISE_LIBRARY_SPEC.md](gym/EXERCISE_LIBRARY_SPEC.md) — built-in exercise library, autocomplete, info sheet w/ photos + instructions. *(Largely built: `ExerciseAutocomplete`, `ExerciseInfoSheet`, `library` routes.)*
- [GYM_EDITS.md](gym/GYM_EDITS.md) — gym UI edit notes.

## food/
- [FOOD_COACH_SPEC.md](food/FOOD_COACH_SPEC.md) — per-meal blurb, Today's Fuel summary, ask-your-coach thread.
- [FOOD_LOGGING_SPEC.md](food/FOOD_LOGGING_SPEC.md) — add food, quick drink, barcode scan (Food Logging v2).
- [FOOD_VOICE_SPEC.md](food/FOOD_VOICE_SPEC.md) — voice food logging (Orb V2).
- [PHOTO_MEAL_REFINE_SPEC.md](food/PHOTO_MEAL_REFINE_SPEC.md) — photo-meal follow-up refinement (Snap-a-Meal v2).
- [FOOD_PHOTO_PROMPT.md](food/FOOD_PHOTO_PROMPT.md) — food-photo user-description prompt.

## mentor/
- [MENTOR_SPEC.md](mentor/MENTOR_SPEC.md) — Mentor page full build spec.
- [LONGITUDINAL_PATTERNS_SPEC.md](mentor/LONGITUDINAL_PATTERNS_SPEC.md) — longitudinal pattern recognition for the Mentor.

## voice/
- [VOICE_SPEC.md](voice/VOICE_SPEC.md) — Atlas voice logging ("The Orb").
- [ORB_SUGGESTIONS_SPEC.md](voice/ORB_SUGGESTIONS_SPEC.md) — suggested replies, learned commands, mic behavior.

## health/
- [APPLE_HEALTH_SYNC_SPEC.md](health/APPLE_HEALTH_SYNC_SPEC.md) — easy Apple Health onboarding (pre-built iCloud Shortcut + scheduled Automations) so a family member can connect in a few taps; surface today's steps on the wearables card. **Built; waiting on the iCloud Shortcut link.**

## platform/
- [MCP_SERVER_SPEC.md](platform/MCP_SERVER_SPEC.md) — Atlas MCP server (Claude tools over remote MCP) + table gotchas.

## _archive/
Stale plans, handoffs, and superseded context docs kept for reference:
`PLAN_gym_coach_fix.md`, `PLAN_whoop_token_fix.md`, `WHOOP_ISSUE_HANDOFF.md`, `SESSION.md`,
`ATLAS_CONTEXT.md`, `LEARNING_CONTEXT.md`. (The living project context is `CLAUDE.md` at root.)
