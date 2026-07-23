# VOICE_SPEC.md — Atlas Voice Logging ("The Orb")

## 0. Context

Jarvis-style voice logging: tap the Orb anywhere in Atlas, say "did bench 8 at 135, took my magnesium and multivitamin, weight is 176" and it all lands in the right tables — with clarifying questions (tap chips or speak) when something is ambiguous.

The codebase already contains every building block:

- **Voice capture + transcription**: `src/features/journal/useVoiceRecorder.ts` (MediaRecorder, webm/mp4 fallback) + `POST /api/mentor/transcribe` (OpenAI `gpt-4o-transcribe`). Claude cannot transcribe audio, so this pipeline stays.
- **The action-proposal pattern**: `src/app/gym/GymChatbot.tsx` + `src/app/api/gym/chat/route.ts` + `src/features/gym/coachActions.ts` — a FAB that opens a chat sheet, streams Claude (`claude-sonnet-4-6`) with tool use as NDJSON events, renders tool calls as **confirm cards**, and only mutates on confirm via existing TanStack hooks.
- **Chat persistence**: `src/lib/usePersistentChat.ts` — localStorage threads, one key per surface.

The feature: **promote the gym coach into a global "Atlas Orb" assistant — same pattern, all modules' logging tools plus the gym coach's existing tools — with a voice-first capture surface on top.**

Decisions (Luka, 2026-07-05):
- **The Orb replaces the Gym Star.** One globe orb on every page except Mentor. The gym coach's abilities fold into the Orb; GymChatbot and its dedicated route are retired at the end of the migration.
- **Both surfaces day one**: the Orb AND voice logging through Mentor chat. Same action backend — you can log anything from either.
- **Separate threads, deliberately.** Mentor is for long conversations; the Orb is for quick capture and actions. They are NOT merged. The Orb has exactly one thread, synced across every page it appears on (Home, Gym, Health, Journal) — opening it anywhere shows the same conversation. (The legacy `/workouts` module was deleted 2026-07-05; check-in hooks now live in `src/features/checkins/`.)
- **Mentor chats get saved.** Mentor moves from a single localStorage thread to DB-backed conversations with browsable history (see §8).
- **Confidence-based confirm**: parsed entries show as pre-approved cards with one-tap "Confirm all"; ambiguous ones become clarifying questions with tappable options; nothing writes silently.
- **V1 scope**: workout sets, supplements, body weight, water, caffeine, journal/check-in notes, plus the inherited gym-coach actions. **Food deferred** (its OpenAI wizard flow stays untouched).

## 1. What this is

A global voice-first assistant that turns speech into logged data and actions across Atlas. Two entry points, one backend:

1. **The Orb** — an Atlas-globe FAB, bottom-right (exact placement tunable), on **every page except `/mentor` (and `/login`)**. It replaces the Gym Star: on the gym page it is the gym coach, everywhere else it's the same assistant with the same powers. Tap → capture sheet slides up → tap mic → speak → transcript parses into confirm cards → one tap logs everything. **One thread, shared across all pages.**
2. **Mentor chat** — the existing mic input keeps working, but the mentor route gains the same tools, so "log that I took creatine" in Mentor produces the same confirm card inline in the conversation. Mentor remains its own persona and its own (now persisted) chat history.

One assistant, one tool set, everywhere. All tools are available from any page (you can swap an exercise from Home or log water from the gym); a `page` hint in the request lets the prompt lean gym-coach on `/gym` without changing capabilities.

## 2. Done / Wrong (acceptance criteria)

**Done looks like:**
- Saying "bench 8 reps at 135, took my magnesium and multivitamin, weight 176" produces 4 pre-approved cards (1 set, 2 supplement doses, 1 weight) in under ~4s after transcription; "Confirm all" writes all 4 and each card flips to its done state.
- Saying "log my weight" (no number) produces a clarifying question with quick-reply chips (e.g. "176 like yesterday?") — answerable by tap, typing, or speaking again.
- Everything the Gym Star could do still works, now through the Orb on `/gym`: "swap incline press for flys", "build me a 6-week strength program" (opens the Program Generator prefilled), "log 3 sets of squats at 185".
- Data lands in the **same tables via the same mutations** the manual UIs use, so every page (health dashboard, gym PO charts, streaks) updates with no new read paths.
- The Orb shows the same thread whether opened from Home, Gym, Health, or Journal; it survives refresh (localStorage) and works on the deployed PWA on iPhone Safari.
- Mentor conversations are saved: past chats are listable by title/date and reopenable; "New chat" starts fresh.

**Wrong looks like (guardrails):**
- ❌ Anything written to the DB without a confirmed card. The model proposes; only user confirmation mutates.
- ❌ A misheard number silently logged ("185" vs "135"). Cards always display the parsed values before commit.
- ❌ Duplicate supplement doses: context includes today's already-logged doses; the model must not re-propose a dose already taken (and the card shows "already logged today" state if it does).
- ❌ New parallel write paths. No new INSERT endpoints for logging — commits go through existing client mutations (which already handle invalidation, optimistic updates, and the weight→profile side-effect).
- ❌ Losing gym-coach capability in the migration. Every `GymCoachAction` kind must have a working equivalent before GymChatbot is deleted.
- ❌ Losing the current mentor thread when history lands — migrate the localStorage thread into the first saved conversation, or at minimum leave it readable until the user starts a new chat.
- ❌ Touching the food logging flow, the journal voice-note flow, or the Oura sync.

## 3. Architecture

```
 Orb sheet (every page incl. gym)          Mentor chat
        │                                      │
        │ mic → MediaRecorder → POST /api/assistant/transcribe
        │ transcript                           │ transcript
        ▼                                      ▼
 POST /api/assistant/chat              POST /api/mentor/chat (gains same tools
        │                                      + saves conversations, §8)
        │  Claude claude-sonnet-4-6 + assistant tools (strict schemas)
        │  streams NDJSON: {t:'text'} {t:'action'} {t:'clarify'} {t:'error'}
        ▼
 Client renders text + ActionCards + clarify chips
        │ user taps Confirm / Confirm all
        ▼
 Existing TanStack mutations execute the writes
 (useLogSet, useLogSupplementDose, useLogBodyWeight, useLogWater, useLogCaffeine,
  useCreateEntry, useSaveMorning/EveningCheckin, useCreateExercise, useUpdateExercise,
  useDeleteExercise, useSaveGymConfig — the same hooks GymChatbot uses today)
```

**Why client-side commit:** every v1 action already has a working client mutation with correct query-key invalidation; sets and check-ins don't even have populated-insert API routes (sets are create-then-update, check-ins are client-side Supabase upserts). Reusing the hooks avoids duplicating that logic server-side — and it's how GymChatbot already works.

### 3.1 Shared contract — `src/features/assistant/actions.ts`

Discriminated union `AssistantAction` = the new logging kinds **plus the existing `GymCoachAction` kinds absorbed as-is** (their payloads and card copy are already proven in `coachActions.ts` / `describeAction`):

| kind | payload | executes via |
|---|---|---|
| `log_set` | `exercise_id, exercise_name, weight, reps` | `useLogSet` (gym_logs) |
| `log_supplement_dose` | `supplement_id, supplement_name, time_slot` | `useLogSupplementDose(today)` |
| `log_weight` | `weight` | `useLogBodyWeight` (upsert on `date_key`, syncs profile) |
| `log_water` | `amount_oz` | `useLogWater(today)` |
| `log_caffeine` | `source, amount_mg` | `useLogCaffeine(today)` |
| `add_journal_note` | `body, mood?` | `useCreateEntry` |
| `checkin_note` | `slot: 'morning'\|'evening', trained/planned, text?` | `useSaveMorningCheckin` / `useSaveEveningCheckin` |
| `adjust_exercise` | (as in coachActions.ts) | `useUpdateExercise` |
| `add_exercise` | (as in coachActions.ts) | `useCreateExercise` + `useSaveGymConfig` |
| `remove_exercise` | (as in coachActions.ts) | `useDeleteExercise` |
| `swap_exercise` | (as in coachActions.ts) | delete + create (as GymChatbot does) |
| `propose_workout` | (as in coachActions.ts) | `useSaveGymConfig` + `useCreateExercise` |
| `generate_program` | (as in coachActions.ts) | opens Program Generator (see 3.5) |

Stream events: `{t:'text',v}` · `{t:'action',action}` · `{t:'clarify',question,options[]}` · `{t:'error',v}`.

Dates are computed **client-side at commit time** matching each host page's convention: `rolledDate()` for supplements/water/weight `date_key`, `toLocalDate(tz)` for caffeine (exactly what those pages pass to the hooks today).

### 3.2 API — `src/app/api/assistant/chat/route.ts`

Start from `api/gym/chat/route.ts` (auth pattern per CLAUDE.md: `createClient()` for auth, `createServiceClient()` for reads) and extend:

- **Model**: `claude-sonnet-4-6`, `max_tokens ~1500`, streaming.
- **Body**: `{ message: string, history: {role,content}[], page?: string }` (last ~10 turns; `page` = current pathname for prompt specialization only).
- **Context loaded per request** (parallel; all small single-user tables — this is NOT the mentor's 10-query data dump):
  - supplements: `id, name, times` + today's `supplement_logs` (dupe prevention, slot inference)
  - gym exercise catalog + config/days + active program flag (everything the gym route loads today — needed for the inherited gym tools)
  - last logged set per exercise ("same as last time") + latest body weight (clarify-chip suggestions)
  - user timezone + current local time (slot inference: morning/afternoon/evening)
- **Tools**: one per action kind, `strict: true`, plus a `clarify` tool (`question, options[]` — max 4 short options). Tool descriptions are prescriptive about *when* to call ("Call when Luka states a completed set with an exercise, weight, and reps…"). The gym tool definitions port over from the gym route unchanged.
- **System prompt rules**: propose only what was explicitly said; never invent numbers; if a required value is missing or the transcript is garbled, call `clarify` instead of guessing; multiple statements in one utterance → multiple parallel tool calls; reference supplements/exercises by `[id]` from context; keep text terse ("Got it — 3 things below" not paragraphs). Port the gym route's coaching rules ("don't say done, say what you're proposing") verbatim — they encode the confirm-card contract.
- Streams tool_use blocks as they complete → `{t:'action'}` / `{t:'clarify'}` lines (accumulate `input_json_delta` exactly like the gym route does).

### 3.3 Transcription — `src/app/api/assistant/transcribe/route.ts`

Lift the body of `api/mentor/transcribe/route.ts` into a shared helper (`src/lib/transcribe.ts`), keep the mentor route as a thin wrapper for backward compat. FormData field `audio` → `{ text }`. `maxDuration = 60`.

### 3.4 Mentor integration

`api/mentor/chat/route.ts` gains the same tool array (imported from `src/features/assistant/tools.ts`) and upgrades its plain-text stream to the same NDJSON protocol. `MentorClient.tsx`:
- stream reader parses NDJSON lines instead of raw text (text deltas append exactly as before),
- renders `ActionCard`/clarify chips inside assistant bubbles,
- existing `useVoiceInput` untouched — voice → transcript → send already works, actions now just appear in the reply.

Risky change (mentor works today). Do it last; verify plain conversation still streams before wiring cards. Mentor chat persistence (§8) lands in the same phase since it touches the same files.

### 3.5 Gym Star retirement

- `GymClient` stops rendering `<GymChatbot>`; the globally-mounted Orb is now the assistant on `/gym` too.
- **`generate_program` handoff**: the Orb is mounted in `layout.tsx`, so it can't call GymClient's `onGenerateProgram` prop. On confirm: stash the `GeneratorPrefill` in `sessionStorage['atlas-generator-prefill']`; if not on `/gym`, `router.push('/gym')`; GymClient reads + clears the stash on mount/focus and opens the Program Generator sheet. (This also makes "build me a program" work from Home.)
- Thread migration: the Orb uses one global thread `atlas-orb-thread-v1`. The old `atlas-gym-coach-thread-v1` key is simply abandoned (device-local, nothing important lost).
- After Orb parity is verified on `/gym` (checklist §9), delete `GymChatbot.tsx` and `api/gym/chat/route.ts`; `coachActions.ts` types move into `assistant/actions.ts`.

## 4. UI — the Orb

**Component**: `src/features/assistant/OrbAssistant.tsx`, portal-rendered (same pattern as GymChatbot). Mounted **once** from `layout.tsx` next to `TabBar`, with `HIDDEN_ON`: `/login`, `/mentor`. Present everywhere else — including `/gym`, the HUD map view, and the `/journal/new` focus screen — and because it's a single component with a single thread key, the conversation is identical on every page.

- **FAB**: 44px round button, `fixed right-4 z-50` above the TabBar (`bottom: ~72px` + safe-area; final position/size to be tuned in build), Atlas-globe glyph (mini version of the HUD globe mark), same translucent style + `whileTap` scale as the existing view-toggle buttons. Takes over the slot the Gym Star occupied on `/gym`.
- **Sheet**: bottom sheet (Framer Motion slide-up, `fixed inset-x-0 bottom-0 z-[70]` + scrim `z-[60]`, mirroring GymChatbot's layout). Contents top-to-bottom: thread (last messages), clarify chips row when pending, input row = text field + mic button + send.
- **Mic flow** (mirrors Mentor's `useVoiceInput`, but built on the shared `useVoiceRecorder`): tap mic → recording state with `Waveform` + elapsed; tap again → stop → transcribe → **auto-send** transcript. Mic-permission error surfaces inline (copy from `useVoiceRecorder`'s error string).
- **ActionCard** (`src/features/assistant/ActionCard.tsx`, extracted from GymChatbot's card rendering + `describeAction`, extended with the new kinds): title + detail (e.g. "Magnesium — evening slot"), per-card Confirm/Dismiss, plus a **"Confirm all (n)"** button when ≥2 pending cards. States: pending → done (✓ label) / dismissed / error (inline message, retry).
- **Thread**: `usePersistentChat('atlas-orb-thread-v1', 40)` — device-local, one key, so Home/Gym/Health/Journal all open the same conversation. Pending (unconfirmed) actions persist with the thread so a refresh doesn't lose them; a "Clear" affordance in the sheet header resets the thread.

## 5. Files

| File | Change |
|---|---|
| `src/features/assistant/actions.ts` | new — action union (new kinds + absorbed GymCoachAction kinds) + stream event types |
| `src/features/assistant/tools.ts` | new — shared Anthropic tool definitions + system-prompt fragment |
| `src/app/api/assistant/chat/route.ts` | new — parse/propose route (gym chat route extended with global tools + context) |
| `src/app/api/assistant/transcribe/route.ts` + `src/lib/transcribe.ts` | new — shared STT; mentor route delegates |
| `src/features/assistant/OrbAssistant.tsx` | new — FAB + sheet + thread + mic |
| `src/features/assistant/ActionCard.tsx` | new — confirm-card component (from GymChatbot + describeAction) |
| `src/features/assistant/useAssistantActions.ts` | new — maps `AssistantAction` → existing mutation per kind, computes day keys, generate_program handoff |
| `src/app/layout.tsx` | mount `<OrbAssistant />` |
| `src/app/gym/GymClient.tsx` | remove `<GymChatbot>`; read `sessionStorage` generator prefill |
| `src/app/gym/GymChatbot.tsx` + `src/app/api/gym/chat/route.ts` + `src/features/gym/coachActions.ts` | **deleted** after parity verified (§9) |
| `src/app/api/mentor/chat/route.ts` | add tools + NDJSON protocol + conversation persistence (§8) |
| `src/app/mentor/MentorClient.tsx` | NDJSON reader + ActionCard rendering + chat history UI (§8) |
| `supabase/migrations/<ts>_mentor_conversations.sql` | new — mentor chat history tables (§8) |

Untouched: food flows, journal voice notes, all read paths, Oura sync.

**Implementation order** (each step shippable): ① contract + assistant route + Orb with the six new logging kinds → ② absorb gym tools into the route/cards, retire the Star, delete GymChatbot → ③ mentor: NDJSON + cards + saved conversations.

## 6. Edge cases

- **"Log my weight" (no number)** → clarify with chips seeded from latest weight ("176 (same as last)", "Type it").
- **Supplement slot**: single configured time → use it; multiple → pick nearest to current local time; none → `'morning'`. Only clarify if the name itself is ambiguous.
- **Unknown supplement/exercise name** → clarify with closest matches as chips; never auto-create catalog entries in v1 (except via the explicit `add_exercise` gym action, which is its own confirm card).
- **"Bench same as last time"** → context includes last set per exercise; model fills values and the card shows them (user still confirms).
- **Garbled transcript** → model calls clarify ("Didn't catch that — try again?"); empty transcript → client shows "didn't hear anything," no API call.
- **Double-tap Confirm** → card disables on first tap (mutation pending state).
- **`generate_program` confirmed away from `/gym`** → stash prefill, navigate to `/gym`, generator opens (see 3.5).
- **Orb over the HUD map view** → HUD overlay is `pointer-events-none` except panels; the Orb's portal sits above it (`z-50`) and stays tappable.

## 7. Deferred (explicitly out of v1)

- **Food via voice** — food has its own multi-round OpenAI wizard (portion questions, photo refine, hydration side-effects); voice would feed transcripts into that flow via a future `log_food` action. Real integration project, not picked for v1.
- **Server-side auto-execution for high-confidence actions** — skip the confirm tap for unambiguous statements, card renders already-done with Undo. Deliberately out: it reintroduces the silent-wrong-data risk. Revisit only if the confirm tap proves to be friction.
- **Wake-word / hands-free + TTS** — "Hey Atlas" background listening isn't feasible in an iOS Safari PWA; TTS is easy but pointless until the core loop earns it.

Decided, not deferred: Mentor and the Orb stay **separate threads** (Mentor = long conversations, Orb = quick capture/actions); the Orb thread is the same across all pages.

## 8. Mentor chat history (bundled requirement)

Mentor's thread is currently one localStorage array (`atlas-mentor-chat-thread-v1`, last 50 messages, device-local, unlistable). Requirement: **mentor chats are saved and browsable.**

- **Tables** (new migration, RLS enabled per convention): `mentor_conversations` (`id, user_id, title, created_at, updated_at`) and `mentor_messages` (`id, conversation_id, user_id NOT NULL, role 'user'|'assistant', content, created_at`).
- **Route**: `/api/mentor/chat` takes an optional `conversation_id`. Missing → create a conversation (title generated from the first message via `claude-haiku-4-5`, same pattern as `generateTitle` for journal). After the stream completes, persist the user message + full assistant reply (in the existing post-stream background step where memories are already written).
- **Client**: active `conversation_id` kept in localStorage; messages for it fetched via TanStack Query (localStorage thread cache retired). History UI: a drawer/sheet from the Mentor header listing conversations newest-first (title + date), tap to reopen, plus a "New chat" button. Existing localStorage thread is imported as the first saved conversation on first run (or left readable until a new chat starts).
- **Reads**: `GET /api/mentor/conversations` (list) and `GET /api/mentor/conversations/[id]` (messages).
- The Orb thread stays device-local — it's a scratchpad; its durable output is the logged data itself.

## 9. Verification

1. `npm run dev`, check `/tmp/atlas-dev.log` clean.
2. Orb on Home: type (mic optional on desktop) "took magnesium and had 20 oz of water" → 2 cards → Confirm all → rows appear in `supplement_logs` / `water_logs` (verify via psql) and Health page reflects both without refresh.
3. "log my weight" → clarify chips → answer → card → confirm → `body_weights` upsert + profile sync.
4. "bench 3 sets of 8 at 135" → 3 `log_set` cards → confirm → gym PO chart updates.
5. **Thread sync**: send a message from Home, open the Orb on Health/Journal/Gym — same conversation everywhere.
6. **Gym parity on `/gym` via the Orb**: "swap incline press for flys" → swap card → confirm; "build me a 6-week strength program" → generator opens prefilled; "log water" from gym works too. Only then delete GymChatbot.
7. Mentor: voice "log that I took creatine" → card inline in reply → confirm → logged; plain conversational message still streams; conversation appears in history, survives refresh, reopens from the list; "New chat" starts a second conversation and both are listed.
8. Repeat "took magnesium" → model declines / card shows already-logged.
9. Prod check on iPhone Safari (real mic, PWA): record, transcribe, confirm — from Home and from `/gym`.
