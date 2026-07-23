# Atlas — Session Context

Read CLAUDE.md and ATLAS_CONTEXT.md first. This file has the current build status and today's task.

---

## Current Build Status (as of 2026-05-27)

### ✅ Fully built and working
- Auth (login, session, redirect)
- Home (`/`) — DayRing, GoalTicker, morning/evening check-ins, nav links
- Workout logger (`/workouts/new`) — create, add exercises, add sets, stepper UI, finish
- Workout history (`/workouts`) — grouped by week, total volume, delete
- Workout detail + AI coach (`/workouts/[id]`) — streaming Claude response, saved to DB
- Tab bar — Home, Gym, Health, Journal, Goals, Debloat, Bills
- Gym / PO coach (`/gym`) — split rotation, per-exercise recommendations, body weight chart, progress photos
- Gym coach devil/angel (`/gym`) — "😈 Yell at me" / "😇 Hype me up" buttons, streaming response
- Health (`/health`) — supplement tracker, water intake, caffeine logging, Oura OAuth, Whoop OAuth
- Food logger (`/health/food`) — photo-based meal logging, AI calorie/macro estimation, 14-day sparkline, edit + delete
- Journal (`/journal`) — entry list, new entry composer, detail with inline editing, streaming AI reflection, delete
- Goals (`/goals`) — habit tracking with streaks + 7-day dots, one-off goals, numeric targets with progress bars, upgraded AI coach
- Debloat (`/debloat`) — bloat level 1–5 selector, 7-day color bar history, daily checklist, AI face photo analysis, full guide accordion
- Subscriptions (`/subscriptions`) — recurring charges tracker, renewal ticker, monthly burn summary, urgent renewal highlighting

### 🔲 Not started
- Home screen cross-module AI coach (daily briefing across all modules)
- Vercel deployment

---

## Next Tasks (in order)

1. **Home coach** — build `/api/home/coach` + add coach section to HomeClient. Prompt file: `AI Coach/home-coach-prompt.md`
2. **Vercel deployment** — connect repo, add env vars, deploy

---

## Key Workflow Reminders

- Always `npx tsc --noEmit` after code changes
- Check `/tmp/atlas-dev.log` for compilation errors after changes
- Two Supabase clients: `createClient()` for auth only, `createServiceClient()` for all DB ops
- Never create `middleware.ts` — Next.js 16 uses `proxy.ts`
- `user_id` is NOT NULL on all tables — always set it from `user.id` server-side
- After building: `git add -A && git commit -m "feat: ..." && git push`
