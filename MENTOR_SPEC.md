# Mentor Page — Full Build Spec for Claude Code

> **Instructions for Claude Code:** Read this entire document before writing a single line of code. Do not run the dev server at any point. Do not run `npm run dev` or any server start commands. Make all code changes, output the SQL migration block as instructed, and stop. Ask questions only if genuinely blocked after checking the existing codebase for patterns first.

---

## What You're Building

The Mentor page is the most important feature in Atlas. It replaces the Goals tab entirely and becomes the primary interface where Luka talks to Atlas — his AI life coach. This is not a simple chatbot. It is a persistent, personalized AI mentor that knows everything about Luka: his workouts, recovery, health, food, goals, thoughts, and how all of those things are trending over time.

The core idea is that Atlas compounds its knowledge of Luka over time. Every conversation makes it slightly more informed. Every piece of data it has access to makes its responses more grounded. Over weeks and months, Atlas should feel like it genuinely knows Luka — his patterns, his tendencies, his goals, what he struggles with, what he's proud of — not like a generic AI responding to prompts.

This is achieved through five mechanisms working together:

1. **A living profile** — a rich, free-text document about Luka that gets updated after every session and is included in every response
2. **Dynamic data fetching** — pulling only the relevant data modules based on what Luka asks
3. **Rolling memory** — session summaries that give Atlas continuity across conversations
4. **Goal progress tracking** — active monitoring and surfacing of goals Luka has set in chat
5. **Auto-calibrating conversation mode** — Atlas reads the tone and intent of each message and shifts its approach accordingly, with a subtle mode label on each response

---

## Visual Design Philosophy

The Mentor page should feel atmospheric, editorial, and slightly cosmic — like a premium wellness app crossed with something from a sci-fi film. Dark background, muted greens as the accent color, clean serif/italic typography for headings, smooth animations throughout. This page should feel noticeably more premium than the rest of Atlas right now. It sets the design direction for where the whole app is going.

**Future vision (do not build yet, but design with this in mind):** The long-term UX direction for Atlas is a solar system metaphor — Luka navigating a cosmic map of his life, with Atlas as his navigator. The Mentor page is the first step toward that aesthetic. Think: dark space, glowing nodes, orbital motion. Every design decision here should feel like it could live in that world.

---

## Visual Layout

Match the dark theme of the rest of Atlas. Reference the existing home page and workout detail page for base component patterns, but push the visual quality higher here. Use Tailwind CSS v4.

The page has two main sections stacked vertically: the **Mentor chat area** at the top, and **The Void** (thought capture) below it, separated by a distinct divider.

---

### Top Section: Mentor Chat

**Header row (two columns):**

Left side:
- Large italic heading: *Mentor* — use a slightly larger font size than other page headings, feels significant
- Subtitle in muted text: *what's on your mind, Luka?*

Right side (Quick Jot card):
- A dark-bordered card labeled `QUICK JOT` in small caps, muted color
- Textarea with placeholder: `idea · reminder · goal...`
- A small `+ goal` chip button and a circular send button with a green arrow icon
- On save: POST to `/api/mentor/jots`, clear the input, animate the jot flying down toward The Void (see animation spec below), increment jot count

**Status bar (horizontal scrollable row of chips):**

Small pill-shaped chips showing live snapshot values pulled on page load. Show whatever is available — gracefully skip chips where data is missing. Each chip slides in from the left with a 80ms stagger between them on page load:
- Green `● LIVE` chip always shown on the left
- Workouts this week (e.g., `WORKOUTS 7D: 3`)
- Current primary goal from mentor_context (e.g., `GOAL: recomp`) — clicking this chip opens a small popover showing Atlas's most recent comment about this goal
- Oura readiness score if available (e.g., `PERF 85%`)
- Oura strain if available (e.g., `STRAIN 4.0`)
- Most recent logged weight if available (e.g., `WEIGHT 174.2 lbs`)

**Intro text:**

Small italic line below the status bar in muted color:
*I can see your profile, workouts, water, weights, wearable, and notes.*

---

### Dynamic Suggested Prompts

**This replaces static hardcoded prompts entirely.** On page load, make a separate lightweight API call to `/api/mentor/prompts` that generates four contextually relevant suggested prompts based on Luka's current data. These should feel personally relevant, not generic.

The prompts API (see route spec below) uses a Haiku call with a snapshot of Luka's recent data to generate four prompts as a JSON array. While they load, show four placeholder pill skeletons with a pulse animation. Once loaded, the four prompts appear with a fade-in stagger.

Examples of what dynamic prompts might look like depending on data:
- If Oura readiness is low: *"Should I train today given my recovery?"*
- If a PR was hit yesterday: *"Break down my progress this month"*
- If no workout in 3+ days: *"What's my training consistency looking like?"*
- If a goal was recently set: *"How am I tracking toward body recomp?"*
- General fallbacks if data is sparse: *"How is my week looking?"*, *"What should I focus on today?"*

Clicking a suggested prompt:
1. Visually "transfers" the text down into the chat input with a 200ms sliding animation
2. Immediately sends the message

---

### Voice Input

The chat input has two modes: **text mode** and **voice mode**. A mic icon button sits to the left of the text input. Tapping it switches to voice mode.

**Voice mode behavior:**
- Input area transforms to show a pulsing recording indicator with a waveform animation (CSS animated bars, not a library) and a timer showing recording duration
- On mobile this would use the device mic; on web use the MediaRecorder API
- When Luka stops recording (clicks stop or the mic button again), immediately POST the audio blob to `/api/mentor/transcribe`
- The transcribe route uses `gpt-4o-transcribe` (not whisper-1) via the OpenAI SDK
- The transcribed text populates the chat input, then auto-sends after a 400ms delay so Luka can see what was transcribed before it goes
- If transcription fails, show the text in the input without sending so Luka can review/edit

**Voice mode UI details:**
- Recording state: input border pulses with a soft red glow, mic icon turns red
- Processing/transcribing state: show a subtle spinner, border returns to normal
- The switch between text and voice should animate smoothly, not jump

---

### Chat Messages Area

Scrollable area between the prompts and the input. Shows the current session's messages only — not persistent across page loads. Auto-scrolls to bottom as Atlas streams.

**Message styling:**
- User messages: right-aligned, solid dark pill/bubble, white text
- Atlas messages: left-aligned, frosted glass treatment — dark background with a very subtle green-tinted border and slight transparency. Think: `bg-white/5 border border-green-900/40 backdrop-blur-sm` or equivalent
- Atlas message enters from slightly below with a 150ms ease-up fade — not a jump
- While Atlas is streaming, show a small animated orb to the left of the message — three dots that pulse sequentially (not simultaneously), in muted green. Disappears once streaming begins

**Streaming behavior:**
- Text streams in token by token with a blinking cursor at the end of the current text
- The cursor is a simple `|` character that blinks at 500ms intervals
- After streaming completes, cursor fades out over 300ms

**Auto mode label (client-side inference, no API call):**

After streaming completes, infer the conversation mode from the response text using simple heuristics and display a small pill label beneath the Atlas message:

```ts
function inferMode(text: string): 'COACH' | 'REFLECT' | 'PLAN' | null {
  const lower = text.toLowerCase()
  const questionCount = (text.match(/\?/g) || []).length
  const hasSteps = /(\d\.|step |first,|second,|next,|then,|finally,)/.test(lower)
  if (questionCount >= 2) return 'REFLECT'
  if (hasSteps) return 'PLAN'
  if (/you need to|you should|push|honest|direct|the truth|call it/.test(lower)) return 'COACH'
  return null // don't show a label for neutral responses
}
```

The label renders as a tiny pill below the Atlas message bubble, fading in over 200ms after streaming ends. Style: `text-[10px] uppercase tracking-widest opacity-50` in muted green. Examples: `· coach ·`, `· reflect ·`, `· plan ·`. If the inferred mode is null, render nothing.

---

### Chat Input

Full-width input at the bottom of the chat area. Placeholder: `ask me anything, Luka...`. Enter to send, Shift+Enter for newline. Disabled while streaming (visual opacity reduction, not hidden). Circular send button on the right with a green arrow.

Mic button on the left of the input (see Voice Input above).

---

### Goal Progress in Status Bar and Chat

When Luka sets a goal in chat (detected by phrases like "my goal is", "I want to", "I'm trying to", "I'm aiming for"), Atlas extracts it, saves it to `mentor_context.primary_goal`, and from that point forward:

- The GOAL chip in the status bar updates to show the goal
- Clicking the GOAL chip opens a small popover showing: the goal text, when it was set, and the most recent thing Atlas said about it (stored as `mentor_context.goal_last_comment` — a new field)
- In subsequent conversations, Atlas actively references goal progress when relevant. It doesn't wait to be asked — if the data supports a progress update, it surfaces it naturally
- After any chat session where goal progress was discussed, save Atlas's comment about the goal into `mentor_context.goal_last_comment` so the chip popover stays current

---

### The Void Section

Separated from chat by a full-width divider containing the label: `MEMORY · X THOUGHTS` in small caps, muted (X = total jot count, fetched on load).

**Entrance animation:** When the user scrolls to this section (use Intersection Observer), the heading fades up from 20px below its final position over 400ms. The jots below cascade in with a 60ms stagger per item.

Large italic heading: *The void.*

Body text in muted, centered style:
*You have about fifty thousand thoughts a day. Most disappear. The ones that matter live here, and the mentor will remember them for you.*

Jots displayed as a vertical list, newest first, limit 20. Each jot shows content and relative timestamp (`2 hours ago`, `yesterday`, `3 days ago`). No edit or delete for now.

**Empty state (zero jots):** Do not show a generic empty message. Show only the heading and body text — the absence of jots should feel intentional and poetic, not like a broken UI state.

**Quick Jot save animation:** When Luka saves a jot, a ghost copy of the jot text should animate from the Quick Jot card in the top right, travel down the page in an arc toward The Void section, and dissolve as it arrives. The THOUGHTS counter increments with a spring bounce animation (scale 1 → 1.2 → 1 over 200ms). This should feel satisfying and tactile.

---

## Navigation

In the bottom tab bar, replace the Goals tab with a Mentor tab. Use a brain, sparkle, or chat-bubble icon — whichever fits best from the current icon library. Route: `/mentor`.

---

## Database Schema

**Output the following SQL as a comment block at the very top of `/src/app/api/mentor/chat/route.ts` so Luka can copy it into the Supabase SQL editor. Do not attempt to run migrations automatically.**

```sql
-- ============================================================
-- MENTOR MIGRATION — run in Supabase SQL editor
-- ============================================================

-- Quick-capture thoughts ("The Void")
create table if not exists jots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  created_at timestamptz default now()
);
alter table jots enable row level security;
create policy "Users access own jots" on jots
  for all using (auth.uid() = user_id);

-- Per-session memory summaries (rolling, capped at 20)
create table if not exists mentor_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  created_at timestamptz default now()
);
alter table mentor_memories enable row level security;
create policy "Users access own memories" on mentor_memories
  for all using (auth.uid() = user_id);

-- Living user profile (one row per user, upserted after each session)
create table if not exists mentor_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  primary_goal text,
  about_me text,
  goal_last_comment text,
  updated_at timestamptz default now()
);
alter table mentor_context enable row level security;
create policy "Users access own context" on mentor_context
  for all using (auth.uid() = user_id);
```

---

## API Routes

Follow the exact auth pattern used in every other API route in this codebase: `createClient()` for auth only, `createServiceClient()` for all DB operations.

---

### `POST /api/mentor/chat`

This is the main route. Read this section fully before writing it.

**Step 1 — Auth and load persistent context**

Authenticate the user. Then fetch in parallel:
- `mentor_context` row for this user (primary_goal, about_me, goal_last_comment)
- Last 5 `mentor_memories` rows, ordered by `created_at` descending

**Step 2 — Keyword-based data fetching (Option B)**

Parse the user's message (lowercase) against these patterns and fetch only the matching data modules. Run all matching fetches in parallel with `Promise.all`.

| Keywords | Data to fetch |
|---|---|
| `workout / gym / lift / exercise / sets / reps / bench / squat / deadlift / press / training / volume` | Last 4 weeks of workouts with exercises and sets (same query as existing coach route) |
| `recovery / sleep / hrv / readiness / rest / tired / fatigue / oura` | Oura data for last 14 days via `getOuraContextRange` from `src/features/health/ouraContext.ts` |
| `water / hydration / drink / fluid` | Water logs for last 7 days |
| `weight / body / scale / lbs / kg / bodyweight` | Recent weight entries, last 30 days |
| `food / calorie / eat / nutrition / macro / protein / carb / fat` | Recent food/calorie logs |
| `week / how am i / how's my / focus / overview / everything / doing / summary / goal` | Fetch all modules above |

If no keywords match, use only the persistent context — no data fetch. Keeps simple conversational messages fast and cheap.

**Step 3 — Build the system prompt**

```
You are Atlas, Luka's personal AI mentor and life coach. You have been following his journey closely and know him deeply. You speak like a trusted advisor who has earned the right to be direct: honest, specific, occasionally challenging, always in his corner. You reference real numbers and real patterns when you have them. You don't pad responses with filler or motivation-poster language. You ask one good follow-up question when it would deepen the conversation. Keep responses conversational — this is a chat, not a report.

Read the tone and intent of what Luka is asking, and calibrate your approach accordingly:
- If he needs accountability, a hard truth, or a performance read — be direct and challenging. Don't soften it.
- If he seems to be processing something, thinking out loud, or working through a feeling — ask more questions than you answer. Help him think, don't just tell him what to think.
- If he wants a plan, next steps, or tactical guidance — give him specific, sequenced actions. Be concrete.
Shift naturally between these as the conversation evolves. Do not announce the mode or explain your approach — just do it.

[If mentor_context.about_me exists:]
WHO LUKA IS:
[about_me verbatim]

[If mentor_context.primary_goal exists:]
Luka's current primary goal: [primary_goal]

[If mentor_context.goal_last_comment exists:]
Last thing you told him about this goal: [goal_last_comment]

[If memories exist:]
CONTEXT FROM RECENT SESSIONS:
- [memory 1]
- [memory 2]
...
```

**Step 4 — Build the user message**

Combine the user's actual message with any fetched data, formatted as clean human-readable text. Label each section clearly (`WORKOUT HISTORY:`, `OURA RECOVERY DATA:`, `WATER LOGS:`, etc.). Use `formatWorkout` pattern from the existing coach route for workout data. Use `summarizeOuraForCoach` for Oura data.

**Step 5 — Stream the response**

Model: `claude-sonnet-4-6`
Max tokens: 600
Stream using the same `ReadableStream` + `anthropic.messages.stream` pattern as the workout coach route. Collect `fullText` as it streams.

**Step 6 — Post-stream background processing**

After the stream closes, fire these background operations without awaiting them before returning. Use `.catch(console.error)`.

**Operation A — Save memory summary:**

If `fullText` is longer than 150 characters, call `claude-haiku-4-5-20251001` (non-streaming) with:

```
Summarize this mentor conversation in 2-3 sentences. Focus on: what Luka asked about, what Atlas told him, any goals or intentions Luka expressed, and any notable patterns or insights. Be specific — include actual numbers or facts if they appeared. This will be used as long-term memory.

USER: [message]
ATLAS: [fullText]
```

Save to `mentor_memories`. Delete any memories beyond the 20 most recent for this user.

**Operation B — Update living profile:**

If `fullText` is longer than 150 characters, call `claude-haiku-4-5-20251001` (non-streaming) with:

```
You are updating a living profile document about Luka. Below is the current profile and a conversation that just happened. Rewrite the profile to incorporate anything new you learned — new goals, new patterns, new context, new struggles, new wins. Keep everything that's still accurate. Make it richer and more specific. The profile should read like a well-informed advisor's notes about someone they know well. Aim for 10-18 sentences. Write in third person.

CURRENT PROFILE:
[mentor_context.about_me or "No profile yet — this is the first session."]

CONVERSATION:
USER: [message]
ATLAS: [fullText]

Write the updated profile now:
```

Upsert the result into `mentor_context.about_me`. Also check if the conversation revealed a goal statement and if so, upsert into `mentor_context.primary_goal`.

Additionally, if the conversation discussed goal progress, extract Atlas's key comment about the goal and save it to `mentor_context.goal_last_comment`.

---

### `GET /api/mentor/prompts`

Generates four dynamic suggested prompts based on Luka's current data. Called on page load separately from the chat.

Auth the user. Fetch in parallel:
- Last completed workout (date + exercises)
- Oura readiness score for today if available
- Days since last workout
- `mentor_context.primary_goal`
- Count of recent jots (last 7 days)

Call `claude-haiku-4-5-20251001` (non-streaming) with a snapshot of this data and this prompt:

```
Generate exactly 4 short, specific suggested questions Luka could ask his AI mentor right now, based on his current data. Make them feel personally relevant to what's actually going on with him, not generic. Return ONLY a JSON array of 4 strings, no other text.

DATA:
[formatted snapshot of the fetched data]

Goal: [primary_goal or "not set"]

Rules:
- Each prompt is 4-8 words
- At least 2 should reference specific data points
- Vary the topics (don't make all 4 about the same thing)
- Sound natural, like something a person would actually ask
```

Return `{ prompts: string[] }`. If the Haiku call fails, return these fallback prompts: `["How is my week looking?", "What should I focus on today?", "How is my recovery trending?", "Am I making progress on my goal?"]`

Cache this response for 10 minutes using a simple timestamp check in the route — no need for a full caching layer.

---

### `POST /api/mentor/transcribe`

Accepts a multipart form upload with an audio blob field named `audio`.

Use the OpenAI SDK (`openai` package — check if already installed, install if not). Call `openai.audio.transcriptions.create` with model `gpt-4o-transcribe`. Return `{ text: string }`.

If transcription fails, return a 500 with `{ error: "Transcription failed" }` so the client can handle it gracefully.

---

### `POST /api/mentor/jots`

Body: `{ content: string }`. Validate non-empty. Insert into `jots` with user_id. Return `{ id, content, created_at }`.

---

### `GET /api/mentor/jots`

Return jots for user ordered by `created_at` descending, limit 20. Also return `{ jots: [], total_count: number }` where total_count is the full count (for the chip display).

---

### `GET /api/mentor/context`

Return the user's `mentor_context` row. If none exists, return `{ primary_goal: null, about_me: null, goal_last_comment: null }`.

---

## Animation Spec

Implement all animations with CSS transitions and Tailwind classes where possible. Use `requestAnimationFrame` for the jot flight animation. Do not add any animation libraries.

| Element | Animation |
|---|---|
| Status bar chips | Slide in from left, 80ms stagger per chip, `translateX(-20px) → 0` over 300ms ease-out |
| Suggested prompts | Fade in with 60ms stagger after load, `opacity 0 → 1` over 250ms |
| Prompt skeleton | Pulse animation while loading (Tailwind `animate-pulse`) |
| Prompt click | Text slides down toward chat input, 200ms ease, then input populates and sends |
| Prompt hover | Faint green border glow (`shadow-green-900/50`), scale 1.01 |
| Atlas message entrance | Fade up from 10px below, 150ms ease-out |
| Streaming cursor | `|` character blinks at 500ms interval, fades out over 300ms on stream end |
| Streaming orb | Three dots pulse sequentially (not simultaneously) in muted green |
| Quick Jot save | Ghost text arcs from top-right to The Void section, dissolves on arrival (implement with absolute positioning and `requestAnimationFrame`) |
| THOUGHTS counter | Spring bounce: scale 1 → 1.2 → 1 over 200ms on increment |
| The Void section | Intersection Observer triggers fade-up on scroll into view, 400ms ease |
| Jot list items | Cascade in with 60ms stagger, `translateY(10px) → 0` over 250ms |
| Voice recording border | Pulsing red glow on chat input while recording |
| Voice waveform | 5 animated bars with staggered height oscillation (pure CSS keyframes) |
| Goal chip popover | Fade in with 150ms ease, slight scale from 0.95 → 1 |
| Chat bubble (Atlas) | `bg-white/5 border border-green-900/40 backdrop-blur-sm rounded-2xl` |

---

## The Living Profile — What It Should Become

To give Claude Code a sense of what `about_me` is meant to evolve into over weeks of use, here is an example of a well-developed profile. It starts sparse on day one and grows with every session:

> Luka is 18 years old, a rising college freshman who just graduated high school. His primary goal is body recomposition — building muscle while reducing body fat simultaneously. He lifts 4-5 days per week and tracks his sessions in detail: sets, reps, weight, and RPE. He trains with clear intentionality but has a tendency to push hard even when his Oura recovery score is low, which is a recurring pattern worth flagging.
>
> His sleep averages around 6.5-7 hours but varies significantly. He is aware of the sleep-performance connection but hasn't fully adjusted his behavior around it yet. His Oura HRV baseline is moderate — noticeable drops tend to precede lower-quality training sessions, though he often doesn't connect those dots in the moment.
>
> Luka is building Atlas — this app — as his main summer project. He is teaching himself to think and work as an AI-native developer, which matters to him both as a craft and as a competitive advantage going into college. He moves fast, prefers direct answers, and doesn't want things over-explained. He responds well to being challenged and tends to rise when pushed.
>
> He has mentioned having a very high volume of thoughts throughout the day that usually disappear before he can act on them. He uses the Void to capture them. He tends to want to build everything at once and benefits from being pushed to focus on one thing at a time. He is intrinsically motivated but occasionally hits mid-week dips in energy and motivation that he pushes through rather than adapting to.
>
> He is interested in body recomposition specifically — not just weight loss or pure muscle gain — which requires careful attention to protein intake, recovery, and progressive overload. He tracks progressive overload across key lifts. He uses Oura for recovery data.

---

## What to Tear Down

Search the codebase for all imports from the goals directory before deleting. Then:

- Delete `src/app/goals/` — entire directory
- Delete `src/app/api/goals/` — entire directory
- Remove the Goals tab from the bottom nav and replace with Mentor
- Remove any links or references to `/goals` from other pages

If the goals table in Supabase has foreign keys referenced by another table, do not drop it — add a comment in the migration SQL flagging it for Luka to handle manually.

---

## Feature: Weekly Atlas Report

Every Sunday, Atlas generates a full weekly synthesis of Luka's life across all modules. This is not a chat response — it is a structured document that gets saved and is permanently accessible. Over time it becomes a record of Luka's growth week by week.

### How it triggers

On the first app open each week (Monday through Sunday), check if a report exists for the current week (week_of = most recent Sunday's date). If not, and if today is Sunday or later in the week, generate one. This check happens client-side on the home page — if no report exists for this week, show a trigger that generates it.

Additionally, if Luka opens the app on Sunday for the first time that day, show a full-screen modal pop-up with the report preview and a button to expand. The modal appears once per week — track last_shown in localStorage.

### Database addition (add to SQL migration block)

```sql
create table if not exists weekly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_of date not null, -- the Sunday that starts this week
  report_text text not null,
  created_at timestamptz default now(),
  unique(user_id, week_of)
);
alter table weekly_reports enable row level security;
create policy "Users access own weekly reports" on weekly_reports
  for all using (auth.uid() = user_id);
```

### `POST /api/mentor/weekly-report`

Auth the user. Fetch the past 7 days of data across all modules in parallel:
- All completed workouts with exercises and sets
- Oura data for the full week via `getOuraContextRange`
- Water logs for the week
- Weight logs for the week
- Food/calorie logs for the week
- All jots created this week
- `mentor_context` (primary_goal, about_me)
- Previous week's report if it exists (for comparison/progress)

Call `claude-sonnet-4-6` (non-streaming, this is an important document) with this system prompt:

```
You are Atlas. Generate Luka's weekly life report for the week ending [date]. This is a real document he will read and keep. Be specific, use actual numbers, and give him genuine insight — not a summary of what happened, but what it means. Structure it exactly as shown below.
```

Structure the report output as markdown with these sections:
- **The Week in Numbers** — key stats at a glance (total volume, avg sleep, avg readiness, workouts completed, water consistency)
- **What Went Well** — 2-3 specific things with data to back them up
- **What to Watch** — 1-2 patterns or concerns worth flagging, honest and direct
- **Goal Check-In** — one paragraph on progress toward Luka's primary goal, with specific reference to the data
- **Focus for Next Week** — three specific, actionable things to prioritize, not generic advice

Save the result to `weekly_reports` with `week_of` set to the most recent Sunday. Return `{ report_text, week_of }`.

### `GET /api/mentor/weekly-reports`

Return all weekly reports for the user ordered by `week_of` descending, limit 12 (3 months of history).

### UI — Sunday Pop-up

On home page load, check localStorage for `atlas_weekly_report_shown_[week_of]`. If not set and a report exists for this week, show a modal overlay after a 1-second delay:

- Dark modal with a subtle green border glow
- Header: `WEEK OF [date]` in small caps
- Preview: first 3 sentences of the report
- Two buttons: `Read Full Report` (navigates to Mentor page, report tab) and `Later`
- On dismiss, set `atlas_weekly_report_shown_[week_of] = true` in localStorage

### UI — Report History in Mentor Page

Add a second tab to the Mentor page: **Chat** (default) and **Reports**. The Reports tab shows a scrollable list of weekly reports, newest first, each as an expandable card. Collapsed state shows the week date and the "What Went Well" headline. Expanded shows the full report rendered as markdown.

---

## Feature: Jot Synthesis — Atlas Finds Your Patterns

Atlas actively reads your accumulated jots, finds themes and patterns, and surfaces them back to you as a synthesis card in The Void. This turns the Void from a passive dump into an active thinking partner.

### How it triggers

Two ways:
1. **Automatic:** Once per week (check against a `last_synthesized_at` field in `mentor_context`), if Luka has 5+ unread jots, automatically run synthesis in the background on the next mentor page load
2. **Manual:** A small `✦ Synthesize` button at the top of The Void section. Tap it to run synthesis on demand. Shows a subtle loading state while running.

### Database addition (add to SQL migration block)

```sql
create table if not exists jot_syntheses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  synthesis_text text not null,
  jot_count integer not null,
  created_at timestamptz default now()
);
alter table jot_syntheses enable row level security;
create policy "Users access own syntheses" on jot_syntheses
  for all using (auth.uid() = user_id);
```

Also add `last_synthesized_at timestamptz` to `mentor_context`.

### `POST /api/mentor/synthesize`

Auth the user. Fetch all jots from the past 14 days. If fewer than 5, return `{ skipped: true, reason: "not enough jots" }`.

Call `claude-haiku-4-5-20251001` with:

```
You are Atlas. Luka has been capturing thoughts in "The Void" over the past two weeks. Read them all and find the real patterns — not just surface themes, but what they reveal about where his head is at, what he keeps coming back to, what might be worth exploring. Be specific and honest. Write 3-5 sentences, conversational tone, no bullet points. Start directly — no preamble.

JOTS:
[list of jots, each on its own line with date]
```

Save the result to `jot_syntheses`. Update `mentor_context.last_synthesized_at` to now. Return `{ synthesis_text, jot_count, created_at }`.

### UI — Synthesis Card in The Void

The most recent synthesis appears at the top of The Void section, above individual jots, as a visually distinct card:
- Slightly lighter background than the page, subtle green-tinted left border (3px solid)
- Header: `✦ ATLAS NOTICED` in small caps, muted green
- Date of synthesis in small muted text
- Synthesis text in slightly larger body size than the jots below
- Below it, a faint divider, then the regular jot list

The `✦ Synthesize` button sits in the The Void header row, next to the `MEMORY · X THOUGHTS` label. While synthesis is running, the button shows a subtle spinner and is disabled.

Add `useLatestSynthesis()` to `src/features/mentor/queries.ts` — GET `/api/mentor/synthesize` (GET returns latest synthesis, POST generates new one).

---

## Feature: Cosmic Map Navigation

The Cosmic Map is a full alternative navigation mode for Atlas — a visual representation of Luka's life modules as glowing planetary nodes floating in dark space. This is a purely visual/navigation layer — no new data fetching, no new API routes. It is the first step toward Atlas's long-term identity as a cosmic life navigator.

### Where it lives

The home page gets a toggle button in the top-right corner: a small icon that switches between **List View** (current home page) and **Map View** (the cosmic map). The map is a full-page takeover of the home page. State persists in localStorage (`atlas_view_mode`).

### Visual design — be precise

The map is rendered as an SVG or absolutely-positioned div layer over a `#000000` or near-black background. Do not use a canvas element. Do not use any animation or physics libraries — pure CSS animations and transforms only.

**Center node:** Atlas logo or a glowing orb labeled `ATLAS` at the center of the viewport. Subtle white-green radial gradient glow, slow 8-second pulse animation.

**Module nodes:** Five orbiting nodes, one per major module:
- Gym (green glow)
- Health (blue-green glow)  
- Journal (amber glow)
- Mentor (bright green glow, slightly larger)
- Home/Today (white glow)

Each node is a circle with a label below it. Nodes orbit the center at different radii — stagger them so they don't all sit on the same ring. Each has its own slow orbital animation (CSS `@keyframes` rotate on a wrapper div), so they appear to slowly drift around the center. Orbital period should vary: 20s, 25s, 30s, 35s, 40s.

**Activity-based glow intensity:** On map load, fetch a lightweight activity snapshot (workouts this week, journal entries this week, mentor messages today). Use this to set the glow intensity of each node. A module with high recent activity glows brighter — implement by varying the `box-shadow` / `filter: drop-shadow` intensity via inline style. A module with zero activity this week glows faintly, like a distant star.

**Orbital rings:** Each node has a faint elliptical ring showing its orbit path — very low opacity (0.08–0.12), just visible enough to imply the orbital structure without cluttering the view.

**Interaction:**
- Hovering a node stops its orbital animation and scales it up slightly (1.1x), with the label becoming fully visible
- Clicking a node navigates to that module's page with a smooth fade transition
- A subtle star field background — use CSS `radial-gradient` dots or a handful of fixed absolutely-positioned tiny white dots scattered across the background for depth, not a full particle system

**Entry animation:** When switching to map view, nodes fade in one by one with a 150ms stagger, appearing to emerge from the center and drift outward to their orbital position over 600ms.

### `GET /api/home/activity-snapshot`

Returns lightweight activity counts for the map glow calculation:
```json
{
  "gym": 3,       // workouts this week
  "health": 7,    // health logs this week  
  "journal": 2,   // journal entries this week
  "mentor": 5     // mentor messages this week
}
```

Simple count queries, no joins needed. Cache with a 5-minute revalidation.

---

## TanStack Query Hooks

Create `src/features/mentor/queries.ts` with:
- `useJots()` — GET `/api/mentor/jots`
- `useMentorContext()` — GET `/api/mentor/context`
- `useMentorPrompts()` — GET `/api/mentor/prompts`
- `useWeeklyReports()` — GET `/api/mentor/weekly-reports`
- `useLatestSynthesis()` — GET `/api/mentor/synthesize`
- `useActivitySnapshot()` — GET `/api/home/activity-snapshot`

Create `src/features/mentor/mutations.ts` with:
- `useCreateJot()` — POST `/api/mentor/jots`
- `useGenerateWeeklyReport()` — POST `/api/mentor/weekly-report`
- `useRunSynthesis()` — POST `/api/mentor/synthesize`

Follow the exact patterns in `src/features/workouts/queries.ts` and `mutations.ts`.

---

## Data Formatting Helpers

For workout data, reuse or import `formatWorkout` from `src/app/api/workouts/[id]/coach/route.ts` rather than rewriting.

For Oura data, use `summarizeOuraForCoach` from `src/features/health/ouraContext.ts`.

For water and weight, format simply:
```
WATER LOGS (last 7 days):
Jun 9: 2.1L
Jun 8: 1.8L

WEIGHT LOG (last 30 days):
Jun 9: 174.2 lbs
Jun 3: 173.8 lbs
```

---

## Questions Claude Code Can Ask If Genuinely Blocked

Ask only after checking existing codebase patterns first:

- What is the water logging table/column structure? (Check existing health API routes first.)
- What is the weight logging table/column structure? (Check existing health routes first.)
- Is the `openai` npm package already installed? (`cat package.json | grep openai`) — if not, install it.
- Which icon should be used for the Mentor tab — list 2-3 best options and ask Luka to pick.
- If goals table has foreign key dependencies that would break on deletion, list them and ask before dropping.
- Which icon to use for the Map View toggle on the home page — list options and ask.

---

## Completion Checklist

- [ ] SQL migration block output as comment at top of chat route
- [ ] `/app/mentor/page.tsx` and `MentorClient.tsx` exist and render
- [ ] Goals tab replaced with Mentor tab in bottom nav, goals directory deleted
- [ ] `/api/mentor/chat` streams, runs background memory + profile update
- [ ] `/api/mentor/prompts` generates dynamic contextual prompts, has fallback
- [ ] `/api/mentor/transcribe` uses gpt-4o-transcribe, handles failure gracefully
- [ ] `/api/mentor/jots` GET and POST work
- [ ] `/api/mentor/context` GET works
- [ ] Voice input: mic button, recording state, waveform animation, transcribe + auto-send
- [ ] Dynamic prompts load with skeleton, replace with real prompts, animate in
- [ ] Prompt click animates and auto-sends
- [ ] Quick Jot saves with flight animation and counter spring
- [ ] Goal chip in status bar shows popover with goal_last_comment
- [ ] Atlas chat bubbles use frosted glass treatment
- [ ] Streaming cursor blinks, fades on completion
- [ ] The Void entrance animation triggers on scroll
- [ ] Status bar chips stagger in on load
- [ ] TanStack Query hooks created in `src/features/mentor/`
- [ ] Weekly report: `POST /api/mentor/weekly-report` generates and saves report
- [ ] Weekly report: `GET /api/mentor/weekly-reports` returns history
- [ ] Weekly report: Sunday modal pop-up on home page, localStorage-gated
- [ ] Weekly report: Reports tab added to Mentor page with expandable cards
- [ ] Jot synthesis: `POST /api/mentor/synthesize` runs Haiku call, saves to `jot_syntheses`
- [ ] Jot synthesis: Synthesis card renders at top of The Void, visually distinct
- [ ] Jot synthesis: Manual `✦ Synthesize` button in The Void header
- [ ] Jot synthesis: Auto-triggers on mentor page load if 5+ jots and not synthesized this week
- [ ] Cosmic map: Map View toggle on home page, state in localStorage
- [ ] Cosmic map: Five orbiting nodes with CSS orbital animations at varying periods
- [ ] Cosmic map: Activity-based glow intensity from `/api/home/activity-snapshot`
- [ ] Cosmic map: Faint orbital rings, star field background, hover + click interactions
- [ ] Cosmic map: Entry animation — nodes emerge from center on map open
- [ ] Auto mode: system prompt includes calibration instructions
- [ ] Auto mode: client-side `inferMode()` runs after streaming, renders pill label beneath Atlas message
- [ ] Dev server was never started
