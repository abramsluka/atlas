# Atlas — Full Project Context for Claude Code

This file is a complete handoff document. Read it before doing anything in this codebase.

---

## Who You're Working With

**Luka** — self-taught developer, shipped a real consumer PWA called Articulate before this. Fast-moving, learns by building. Wants direct answers and honest pushback, not agreement by default. When something he's doing is wrong, say so.

**How he works:** He'll describe what he wants in plain English, sometimes imprecisely. Interpret the intent, make a judgment call on the best implementation, and build it. Don't ask clarifying questions unless there's a genuine architecture branch point.

**What he knows well:** Next.js App Router, TypeScript, Tailwind, Supabase auth + Postgres, Vercel, Claude API.

**What he's newer to:** TanStack Query (React Query), RLS policies, middleware/proxy layer, env var scoping, streaming APIs.

**Response style:** Direct and terse. Longer sentences preferred over choppy ones. No em-dashes. No "not X but Y" structures. Code blocks for anything he needs to paste.

---

## Project Overview

**Name:** Atlas  
**Purpose:** A personal life-operating-system app — daily dashboard across fitness, health, nutrition, goals, and journaling. Inspired by Whoop/Oura style dashboards but powered by an AI coach that gives real commentary across all modules.

**Vision:** One app that knows everything about Luka — sleep, training, nutrition, supplements, goals — and gives him an AI coach that uses all of it for context.

**Strategy:** One module at a time, built end-to-end before the next.

**Deployment:** Not yet on Vercel. Running locally at localhost:3000.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js App Router (v16.2.6) + TypeScript |
| Styling | Tailwind CSS v4 |
| Database | Supabase (Postgres + Auth + RLS) |
| Data fetching | TanStack Query v5 (`@tanstack/react-query`) |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`) — `claude-sonnet-4-6` |
| Auth | Supabase SSR auth via `@supabase/ssr` v0.10.3 |

**Critical:** Next.js 16 uses `proxy.ts`, not `middleware.ts`. Never create a `middleware.ts` — it will conflict and break everything.

---

## Key Architecture Decisions

### Two Supabase clients — never mix them up

`src/lib/supabase/server.ts` exports two functions:

- `createClient()` — SSR client, reads cookies. Use **only** for `auth.getUser()`.
- `createServiceClient()` — raw supabase-js with service role key. Use for **all** database operations in API routes. Truly bypasses RLS.

`src/lib/supabase/browser.ts` — browser client for client components (read-only queries only, not for mutations that fire on mount).

**Pattern every API route follows:**
```ts
const authClient = await createClient()
const { data: { user } } = await authClient.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

const db = createServiceClient()
// all db reads/writes use db
```

### API Routes for all mutations
All INSERT/UPDATE/DELETE go through Next.js API routes, never the browser client directly. The browser client caused hangs during client-side navigation when used for mutations that fire on mount.

### TanStack Query everywhere
All data fetching uses TanStack Query hooks defined in `src/features/[module]/queries.ts` and `mutations.ts`. No raw `useEffect + useState` for data fetching.

### React Strict Mode guard
In dev, effects fire twice. The workout creation in `workouts/new/page.tsx` uses a `created.current` ref with a cleanup reset to prevent double inserts. Don't remove it.

---

## File Structure

```
src/
├── app/
│   ├── layout.tsx                      # Root layout — providers, TabBar
│   ├── page.tsx                        # Home (server component)
│   ├── HomeClient.tsx                  # Home client — DayRing, GoalTicker, check-ins, nav
│   ├── TabBar.tsx                      # Fixed bottom nav — Home, Gym, Health, Journal, Goals
│   │                                   # HIDDEN_ON: ['/login', '/workouts/new', '/journal/new']
│   ├── providers.tsx                   # TanStack QueryClientProvider
│   ├── login/page.tsx
│   ├── auth/callback/route.ts
│   │
│   ├── gym/                            # Progressive Overload coach tab
│   │   ├── page.tsx                    # Server: auth + fetch config/exercises/bodyweights
│   │   └── GymClient.tsx              # Client: split rotation, PO coach, body weight, photos
│   │
│   ├── health/                         # Health tab
│   │   ├── page.tsx                    # Server: auth + fetch all health data
│   │   └── HealthClient.tsx           # Client: supplements, water, caffeine, wearables
│   │
│   ├── journal/                        # Journal tab
│   │   ├── page.tsx                    # Server: auth + fetch all entries
│   │   ├── JournalClient.tsx          # Client: entry list grouped by month
│   │   ├── new/page.tsx               # Composer — tab bar hidden here
│   │   └── [id]/
│   │       ├── page.tsx               # Server: auth + fetch entry
│   │       └── EntryDetail.tsx        # Client: view/edit + streaming AI reflection
│   │
│   ├── goals/page.tsx                  # Stub — "Coming soon"
│   │
│   ├── workouts/
│   │   ├── page.tsx                    # Forwards to WorkoutHistoryPage (auth guard)
│   │   ├── new/page.tsx               # Active workout logger (tab bar hidden)
│   │   ├── history/page.tsx           # Workout history list client component
│   │   ├── GymClient.tsx              # STALE — old copy, ignore this file
│   │   └── [id]/
│   │       ├── page.tsx               # Workout detail (server component)
│   │       └── WorkoutDetail.tsx      # Detail client + AI coach streaming
│   │
│   └── api/
│       ├── workouts/
│       │   ├── route.ts               # POST — create workout
│       │   └── [id]/
│       │       ├── route.ts           # PATCH — update workout (name, completed_at)
│       │       ├── exercises/route.ts
│       │       ├── exercises/[exerciseId]/sets/route.ts
│       │       └── coach/route.ts     # POST — stream AI coach, save to DB
│       ├── gym/
│       │   ├── config/route.ts        # GET/PUT — GymConfig JSON blob
│       │   ├── exercises/route.ts     # GET/POST
│       │   ├── exercises/[id]/route.ts # PATCH/DELETE
│       │   ├── logs/route.ts          # GET/POST — workout logs
│       │   ├── logs/[id]/route.ts     # DELETE
│       │   ├── bodyweight/route.ts    # GET/POST — body weight entries
│       │   └── photos/
│       │       ├── route.ts           # GET/POST — progress photos
│       │       └── [id]/route.ts      # DELETE
│       ├── health/
│       │   ├── profile/route.ts       # GET/PUT — HealthProfile
│       │   ├── supplements/route.ts   # GET/POST
│       │   ├── supplements/[id]/route.ts     # PATCH/DELETE
│       │   ├── supplements/suggest/route.ts  # POST — AI name suggestions
│       │   ├── supplement-logs/route.ts      # GET/POST
│       │   ├── supplement-logs/[id]/route.ts # DELETE
│       │   ├── water/route.ts         # GET/POST — water logs (today)
│       │   ├── water/[id]/route.ts    # DELETE
│       │   ├── water/history/route.ts # GET — last 14 days
│       │   ├── caffeine/route.ts      # GET/POST
│       │   ├── caffeine/[id]/route.ts # DELETE
│       │   ├── oura/connect/route.ts  # Oura OAuth start
│       │   ├── oura/callback/route.ts # Oura OAuth callback
│       │   ├── oura/data/route.ts     # GET — fetch + cache Oura data
│       │   ├── whoop/connect/route.ts # Whoop OAuth start
│       │   ├── whoop/callback/route.ts
│       │   └── whoop/data/route.ts
│       ├── journal/
│       │   ├── route.ts               # GET/POST
│       │   └── [id]/
│       │       ├── route.ts           # GET/PATCH/DELETE
│       │       └── reflect/route.ts   # POST — stream AI reflection
│       ├── goals/
│       │   ├── route.ts               # GET — list goals+logs, POST — create goal
│       │   ├── coach/route.ts         # POST — stream AI coach
│       │   └── [id]/
│       │       ├── route.ts           # PATCH/DELETE
│       │       └── log/route.ts       # POST/DELETE — habit log for today
│       ├── home/
│       │   ├── coach/route.ts         # POST — stream daily briefing
│       │   └── todays-call/route.ts   # POST — readiness verdict (cached)
│       └── user/
│           └── settings/route.ts      # POST — save timezone

src/features/
├── workouts/
│   ├── queries.ts                      # useWorkouts, useWorkout, useTodayCheckin
│   ├── mutations.ts                    # useCreateWorkout, useDeleteWorkout, useSaveMorningCheckin, etc.
│   └── types.ts                       # Workout, Exercise, WorkoutSet, DailyCheckin, etc.
├── gym/
│   ├── queries.ts                      # useGymConfig, useGymExercises, useGymLogs, useBodyWeights, useProgressPhotos
│   ├── mutations.ts
│   └── types.ts                       # GymConfig, GymExercise, GymLog, BodyWeight, ProgressPhoto
├── health/
│   ├── queries.ts                      # useHealthProfile, useSupplements, useSupplementLogs, useWaterLogs, useWaterHistory, useCaffeineLogs
│   ├── mutations.ts
│   ├── types.ts                       # Supplement, SupplementLog, WaterLog, HealthProfile, CaffeineLog, WearableToken, OuraData, WhoopData
│   ├── supplementDb.ts                # Local supplement name/dose database
│   └── substanceDb.ts                 # Caffeine/stimulant substance database
├── journal/
│   ├── queries.ts                      # useJournalEntries, useJournalEntry
│   ├── mutations.ts                    # useCreateEntry, useUpdateEntry, useDeleteEntry
│   └── types.ts                       # JournalEntry, CreateEntrySchema, UpdateEntrySchema
└── goals/
    ├── queries.ts                      # useGoalsData → { goals, habitLogs }
    ├── mutations.ts                    # useCreateGoal, useUpdateGoal, useDeleteGoal, useLogHabit, useUnlogHabit
    └── types.ts                       # Goal, HabitLog, GoalsData, CreateGoalSchema, UpdateGoalSchema

src/lib/
├── date.ts                             # toLocalDate(tz), daysAgoLocal(n, tz) — ALWAYS use these for calendar date strings
├── getUserTimezone.ts                  # getUserTimezone(userId) — reads from user_settings, falls back to 'UTC'
└── supabase/
    ├── server.ts                       # createClient() + createServiceClient()
    └── browser.ts

proxy.ts                                # Next.js 16 middleware (session refresh)
reference/                             # HTML reference files Claude Code reads for UI design
```

---

## Database Schema

### Core tables (original)

**`workouts`** — id, user_id, name (nullable), completed_at (nullable = in progress), created_at

**`exercises`** — id, workout_id, user_id (NOT NULL), name, order_index, created_at

**`sets`** — id, exercise_id, user_id (NOT NULL), reps (nullable), weight_lbs (nullable), rpe (nullable 1-10), completed (bool), order_index, created_at

**`daily_checkins`** — id, user_id, date (YYYY-MM-DD), morning_planned_training (bool nullable), morning_intent (text nullable), evening_actual_training (bool nullable), evening_reflection (text nullable)

**`workout_coach_responses`** — id, workout_id, user_id, response_text, created_at

### Gym / PO coach tables

**`po_user_config`** — id, user_id, config (jsonb — stores GymConfig blob)

**`po_exercises`** — id, user_id, name, gym_id, day_id, bodyweight (bool), start_weight, rep_min, rep_max, step, order_index

**`po_logs`** — id, user_id, exercise_id, weight, reps, logged_at

**`body_weight_logs`** — id, user_id, date_key (YYYY-MM-DD), weight, created_at

**`progress_photos`** — id, user_id, date (YYYY-MM-DD), storage_path, taken_at, created_at  
(Photos stored in Supabase Storage private bucket `progress-photos`, path `{user_id}/{date}_{timestamp}.{ext}`)

### Health tables

**`health_profile`** — user_id (PK), weight_lbs, daily_water_target_oz, age, sex, activity_hrs_per_week, caffeine_mg_per_day, water_unit, bottle_ml, glass_ml, weight_unit, substances (jsonb), updated_at

**`supplements`** — id, user_id, name, dose, notes, times (text[] — 'morning'|'lunch'|'evening'|'anytime'), running_low (bool), supply_days_remaining (int nullable), order_index, active (bool), created_at

**`supplement_logs`** — id, user_id, supplement_id, date, time_slot, taken_at

**`water_logs`** — id, user_id, date (YYYY-MM-DD), amount_oz, logged_at

**`caffeine_logs`** — id, user_id, date (YYYY-MM-DD), source, amount_mg, logged_at

**`wearable_tokens`** — user_id, provider ('oura' | 'whoop'), access_token, refresh_token, expires_at

### Goals tables

**`goals`** — id, user_id, type ('habit'|'oneoff'|'numeric'), title, description (nullable), target_value (float nullable), current_value (float, default 0), start_value (float nullable), direction ('ascending'|'descending', default 'ascending'), unit (nullable), due_date (date nullable), completed_at (timestamptz nullable), order_index (int, default 0), created_at, updated_at

**`habit_logs`** — id, user_id, goal_id (FK → goals ON DELETE CASCADE), date (date, default CURRENT_DATE), created_at. Unique constraint on (goal_id, date).

### Journal tables

**`journal_entries`** — id, user_id, date (date type), title (text nullable), body (text), mood (int 1-5 nullable), ai_reflection (text nullable), created_at, updated_at

### Settings

**`user_settings`** — user_id (PK), timezone (text, default 'UTC'), updated_at. RLS enabled, no user-facing policies — accessed only via service role.

### RLS
RLS enabled on all tables. All server API routes use `createServiceClient()` which bypasses RLS. Migrations live in `supabase/migrations/` but must be manually run in the Supabase SQL editor. Use `CREATE TABLE IF NOT EXISTS` and a DO block to drop/recreate policies to avoid errors on re-run.

### Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
OURA_CLIENT_ID=
OURA_CLIENT_SECRET=
WHOOP_CLIENT_ID=
WHOOP_CLIENT_SECRET=
NEXT_PUBLIC_APP_URL=           # needed for OAuth callbacks, e.g. http://localhost:3000
```

---

## What's Built and Working

### ✅ Auth
Login, session refresh via proxy.ts, redirect to /login if unauthenticated.

### ✅ Home (`/`)
Day progress ring (time-of-day percent with gradient stroke color), GoalTicker (animated check-in status), morning/evening check-in cards, Today's Call card (wearable-based readiness verdict — GREEN/YELLOW/RED with headline + bullets, cached per day in `todays_call` table), streaming daily briefing coach button. Timezone detection via `Intl.DateTimeFormat().resolvedOptions().timeZone` saved to `user_settings` on mount.

### ✅ Workout logger (`/workouts/new`)
Creates workout on mount with Strict Mode guard. Add exercises by name, add sets per exercise. Reps stepper (±1), weight stepper (±2.5 lbs), RPE chips (1-10, tap to select/deselect). All fields autosave with debounce. Finish workout → sets `completed_at` → redirects to detail page.

### ✅ Workout history (`/workouts`)
Completed workouts grouped by week. Shows name, date, total volume (weight × reps for completed sets). Delete with confirm modal.

### ✅ Workout detail + AI coach (`/workouts/[id]`)
Full exercise/set breakdown with total volume. Streaming AI coach response (fetches last 4 weeks of workout history for context), saved to `workout_coach_responses` after streaming completes.

### ✅ Tab bar
Fixed bottom nav: Home, Gym, Health, Journal, Goals. Hidden on `/login`, `/workouts/new`, `/journal/new`.

### ✅ Gym / Progressive Overload coach (`/gym`)
Split rotation editor (configure gym days + rotation). Per-exercise PO recommendations (target weight + reps, based on last log). Log sets inline. Body weight tracking with sparkline chart. Progress photos — upload via `<input type="file" capture="environment">`, single view, side-by-side comparison, delete with confirm. Settings modal.

### ✅ Health (`/health`)
Supplement tracker — add supplements with name/dose/time slots, log each dose per day, flash missed doses red, running-low flag, supply days remaining. Water intake — personalized daily target calculated from weight/age/activity/caffeine use, log intake, 14-day history chart. Caffeine/stimulant logging — feeds into water target calculation. Oura ring OAuth connection + data display (sleep score, HRV, readiness, activity). Whoop OAuth connection + data display (strain, recovery, sleep, workout heart rate).

### ✅ Journal (`/journal`)
Entry list grouped by month with mood color dots. Full-screen composer at `/journal/new` (optional title, body textarea, 5 mood emoji chips). Entry detail at `/journal/[id]` with inline editing (tap to edit, save/cancel), streaming AI reflection (2-3 sentences, ends with one open question), delete with confirm. Tab bar hidden during composition.

### ✅ Goals (`/goals`)
Three goal types: **Habit** (daily checkbox, 🔥 streak counter, 7-day dot trail), **One-off** (tap to complete, optional due date), **Numeric target** (tap to edit current value inline, progress bar, ascending/descending direction). Completed goals collapsible section. Streaming AI coach via `/api/goals/coach` (uses last 90 days of habit logs for context). Add sheet with 2-step flow (pick type → fill details). Delete with confirm modal.

---

## What's Next

1. **Vercel deployment** — connect repo, add env vars, deploy

---

## Dev Workflow

```bash
# Start dev server (pipe to log so you can check output)
pkill -f "next dev" 2>/dev/null; sleep 1
npm run dev > /tmp/atlas-dev.log 2>&1 &
tail -50 /tmp/atlas-dev.log

# TypeScript check after any code change
npx tsc --noEmit 2>&1 | head -40

# Watch for errors
tail -50 /tmp/atlas-dev.log
```

After changing `.env.local`, always restart the dev server.

## Automated Commit + Push Rule (MANDATORY)

After every session where code was written or edited, Claude Code MUST:

1. Run a TypeScript check first — `npx tsc --noEmit 2>&1 | head -40`. Fix any errors before committing.
2. Stage all changes — `git add -A`
3. Commit with a descriptive message — `git commit -m "feat: <short description of what was built>"`
4. Push to the current branch — `git push`

Do this automatically at the end of every task. Do not wait to be asked. If the push fails due to no upstream, run `git push --set-upstream origin <branch-name>`.

## Automated Migration Rule (MANDATORY)

Whenever a new SQL migration file is created in `supabase/migrations/`, Claude Code MUST run it immediately:

```bash
psql $DATABASE_URL -f supabase/migrations/<filename>.sql
```

`DATABASE_URL` is in `.env.local`. Do not skip this step or ask Luka to run it manually — run it as part of the same task that created the migration file. Always use `CREATE TABLE IF NOT EXISTS` and a DO block for policies so migrations are safe to re-run.

---

## Hard-Won Gotchas

1. **`user_id` required on inserts** — exercises, sets, po_exercises, po_logs, body_weight_logs, and all other tables with `user_id NOT NULL`. Always set from `user.id` on the server, never trust the request body.

2. **Service role client for all API route DB ops** — SSR client fires RLS even alongside the service role key. `createServiceClient()` (raw supabase-js) is the only one that truly bypasses it.

3. **Auth check still uses SSR client** — `createServiceClient()` has no session context. Always `createClient()` first for `auth.getUser()`, then `createServiceClient()` for DB ops.

4. **Never create `middleware.ts`** — proxy.ts is the Next.js 16 middleware. Having both causes a startup crash.

5. **React Strict Mode double-invoke** — workout creation guard (`created.current` ref + cleanup reset) in `workouts/new/page.tsx` handles the dev double-fire. Don't remove it.

6. **RLS migrations run via psql automatically** — use `psql $DATABASE_URL -f supabase/migrations/<file>.sql`. DATABASE_URL is in `.env.local`. Always use `CREATE TABLE IF NOT EXISTS` and a DO block to drop policies before recreating to avoid `ERROR 42710: policy already exists`. Never ask Luka to run migrations manually.

7. **`completed_at = null` means in-progress** — only workouts with a non-null `completed_at` appear in history. The AI coach route returns 400 for unfinished workouts.

8. **Date strings + timezone** — when parsing `YYYY-MM-DD` strings with `new Date()`, append `T12:00:00` to avoid UTC midnight shifting the date to the wrong local day. For computing "today" server-side, always use `toLocalDate(tz)` from `src/lib/date.ts` — never `new Date().toISOString().split('T')[0]` (that's UTC). Get the user's timezone with `getUserTimezone(user.id)` from `src/lib/getUserTimezone.ts`, which reads from `user_settings`. The client detects and saves timezone on home screen mount.

9. **Supabase Storage for progress photos** — private bucket `progress-photos`, path `{user_id}/{date}_{timestamp}.{ext}`. Metadata stored in `progress_photos` table with a `storage_path` column. Signed URLs (60-min expiry) generated at query time.

10. **OAuth callback URLs** — Oura and Whoop both need `NEXT_PUBLIC_APP_URL` set in `.env.local`. Callbacks are `/api/health/oura/callback` and `/api/health/whoop/callback`. These must be registered in the Oura/Whoop developer dashboards too.

11. **`src/app/workouts/GymClient.tsx` is a stale file** — the live Gym module is at `src/app/gym/GymClient.tsx`. The old file was left behind during a routing refactor and can be ignored or deleted.
