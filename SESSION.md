# Atlas — Session Context

Read CLAUDE.md and ATLAS_CONTEXT.md first. This file has the current build status and today's task.

---

## Current Build Status (as of 2026-05-26)

### ✅ Fully built and working
- Auth (login, session, redirect)
- Home (`/`) — DayRing, GoalTicker, morning/evening check-ins, nav links
- Workout logger (`/workouts/new`) — create, add exercises, add sets, stepper UI, finish
- Workout history (`/workouts`) — grouped by week, total volume, delete
- Workout detail + AI coach (`/workouts/[id]`) — streaming Claude response, saved to DB
- Tab bar — Home, Gym, Health, Journal, Goals
- Gym / PO coach (`/gym`) — split rotation, per-exercise recommendations, body weight chart, progress photos
- Health (`/health`) — supplement tracker, water intake, caffeine logging, Oura OAuth, Whoop OAuth
- Journal (`/journal`) — entry list, new entry composer, detail with inline editing, streaming AI reflection, delete
- Goals (`/goals`) — habit tracking with streaks + 7-day dots, one-off goals, numeric targets with progress bars, AI coach

### ✅ Gym coach (devil/angel) — JUST BUILT
- API: `src/app/api/gym/coach/route.ts`
- UI: two-button section at top of gym page ("😈 Yell at me" / "😇 Hype me up")
- Devil mode: harsh, calls out slacking, focuses on consequences of not training
- Angel mode: encouraging, specific to actual data, focuses on who they're becoming
- Context used: days since last workout, workouts this week vs last week, today's check-in, sets logged today, body weight trend

### ✅ Goals coach — UPGRADED
- API: `src/app/api/goals/coach/route.ts` (replaced bad schema references, richer context, better prompt)
- Fixed: was referencing `start_value` and `direction` fields that don't exist in schema
- Now passes: per-habit streak + longest-ever + today status, days on journey, completed goals count
- Prompt rewritten to speak like a mentor who knows you, not a stats summarizer

### 🔲 Goals migration still needs to be run
The SQL file exists at `supabase/migrations/20260525000005_goals.sql`.
Paste it into the Supabase SQL editor: https://supabase.com/dashboard/project/etihxbicbrthxvuvulrj/sql/new

### ✅ Debloat tab — JUST BUILT
- Route: `/debloat` (6th tab in tab bar)
- Bloat level 1–5 selector with 7-day color bar history
- Daily checklist (8 items: warm water, walk, gua sha, belly massage, etc.)
- AI food photo analysis — upload photo, Claude streams bloat feedback
- Full guide with 5 accordion sections (Morning Routine, Foods to Avoid, Foods that Help, Techniques, Lifestyle)
- Migration: `supabase/migrations/20260526000001_debloat.sql` — needs to be run in Supabase SQL editor

### 🔲 Not started
- Subscriptions tracker tab
- Vercel deployment

---

## Next Tasks (in order)

1. **Run goals migration** — paste `supabase/migrations/20260525000005_goals.sql` into Supabase SQL editor
2. **Run debloat migration** — paste `supabase/migrations/20260526000001_debloat.sql` into Supabase SQL editor
3. **Test both** — goals page + debloat tab
4. **Subscriptions tab** — recurring charges tracker
5. **Vercel deployment**

---

## Key Workflow Reminders

- `DATABASE_URL` is in `.env.local` — use `psql $DATABASE_URL` for all migrations
- Always `npx tsc --noEmit` after code changes
- Two Supabase clients: `createClient()` for auth only, `createServiceClient()` for all DB ops
- Never create `middleware.ts` — Next.js 16 uses `proxy.ts`
- `user_id` is NOT NULL on all tables — always set it from `user.id` server-side
- Restart dev server after `.env.local` changes
