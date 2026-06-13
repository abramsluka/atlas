@AGENTS.md

# Atlas — Project Context

Read this fully before touching any code.

## What This App Is

Atlas is a personal life-operating-system app built for Luka. Daily dashboard across fitness, health, nutrition, goals, and journaling. Powered by an AI coach that gives real commentary across all modules. Think Whoop/Oura Ring but with Claude as the brain.

**Strategy:** One module at a time, end-to-end, before starting the next. No premature cross-module architecture.

## Who You're Working With

Luka is a fast-moving developer. Give direct answers, make judgment calls, don't over-explain things he already knows. Push back when something he's asking for is wrong. He knows: Next.js App Router, TypeScript, Tailwind, Supabase, Vercel, Claude API. He's newer to: TanStack Query, RLS policies, streaming APIs.

## Stack

- Next.js App Router v16.2.6 + TypeScript
- Tailwind CSS v4
- Supabase (Postgres + Auth + RLS)
- TanStack Query v5 — used everywhere for data fetching, no raw useEffect+useState for data
- Anthropic Claude API (`claude-sonnet-4-6`)
- `@supabase/ssr` v0.10.3

**Critical:** Next.js 16 uses `proxy.ts` not `middleware.ts`. Never create middleware.ts — it breaks everything.

## Supabase Client Rules — Read This Carefully

Two clients in `src/lib/supabase/server.ts`:

- `createClient()` — SSR client, reads cookies, use ONLY for `auth.getUser()`
- `createServiceClient()` — raw supabase-js with service role key, bypasses RLS, use for ALL database operations in API routes

Pattern for every API route:
```ts
const authClient = await createClient()
const { data: { user } } = await authClient.auth.getUser()
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

const db = createServiceClient()
// all db reads/writes use db, not authClient
```

**Why:** The SSR client passes cookie JWTs and RLS still fires even with the service role key when using @supabase/ssr. The raw createServiceClient() truly bypasses RLS.

## Database Schema

**`workouts`** — id, user_id, name (nullable), completed_at (nullable = in progress), created_at

**`exercises`** — id, workout_id, user_id (NOT NULL, always include in inserts), name, order_index, created_at

**`sets`** — id, exercise_id, user_id (NOT NULL, always include in inserts), reps (nullable), weight_lbs (nullable), rpe (nullable, 1-10), completed (bool), order_index, created_at

**`daily_checkins`** — id, user_id, date (YYYY-MM-DD), morning_planned_training, morning_intent, evening_actual_training, evening_reflection

**`workout_coach_responses`** — id, workout_id, user_id, response_text, created_at

**RLS:** Enabled on all tables. API routes bypass it via createServiceClient().

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
ANTHROPIC_API_KEY
```

After changing .env.local, always restart the dev server.

## File Structure

```
src/app/
  page.tsx                          # Home (server component)
  HomeClient.tsx                    # Home client — checkins + nav
  workouts/
    new/page.tsx                    # Active workout logger
    page.tsx                        # Workout history list
    [id]/page.tsx                   # Detail (server component)
    [id]/WorkoutDetail.tsx          # Detail client + AI coach streaming
  api/workouts/
    route.ts                        # POST — create workout
    [id]/exercises/route.ts         # POST — add exercise
    [id]/exercises/[exerciseId]/sets/route.ts  # POST — add set
    [id]/coach/route.ts             # POST — stream AI coach response

src/features/workouts/
  queries.ts                        # TanStack Query hooks
  mutations.ts                      # TanStack mutations
  types.ts                          # TypeScript interfaces

src/lib/supabase/
  server.ts                         # createClient() + createServiceClient()
  browser.ts                        # browser createClient()

proxy.ts                            # Next.js 16 middleware (session refresh)
```

## What's Built and Working

- Auth (login, session refresh, redirect)
- Daily check-in (morning/evening on home screen)
- Home page with cosmic map (orbiting nodes for each module), activity snapshot, weekly report
- Workout logger (create, add exercises, add sets with reps/weight/RPE, toggle complete, finish)
- Workout history list grouped by week with total volume
- Workout detail page with inline editing and AI coach streaming
- Gym page (progressive overload tracking, gym config)
- Health page (Oura ring integration, food logging, water tracking, body weight, supplements, caffeine)
- Journal (text + voice entries, mood tracking, AI reflection, follow-up conversation thread)
- Mentor (cross-module AI coach — fetches all data sources on every message: workouts, Oura, food, water, weight, journal, check-ins, jots, health profile, PO logs, supplements)
- Bottom tab bar navigation (Home, Gym, Health, Journal, Mentor)

## What's Next

1. **Cosmic map click fix** — orbiting node buttons are not receiving taps/clicks due to overlapping rotating container divs intercepting pointer events. Fix: `pointer-events: none` on the rotating container divs, `pointer-events: auto` on the buttons inside. See `CosmicMap` component in `src/app/HomeClient.tsx`.

2. **Home page redesign (Phase 2)**

3. **Gym page redesign (Phase 2)**

4. **Health page redesign (Phase 2)**

5. **Mentor + Journal visual polish (Phase 2)**

6. **Phase 3 — Polish and motion**

## Deferred (don't build unless asked)

Finances/subscriptions tab, goals module, Vercel deployment.

## Dev Server

```bash
pkill -f "next dev" 2>/dev/null; sleep 1
npm run dev > /tmp/atlas-dev.log 2>&1 &
tail -50 /tmp/atlas-dev.log
```

After code changes, always check /tmp/atlas-dev.log for TypeScript or compilation errors.

## Hard-Won Gotchas

- user_id is NOT NULL on exercises and sets — always include it in inserts
- Service role client for all API route DB ops, SSR client only for auth
- React Strict Mode fires effects twice in dev — the created.current guard in workouts/new/page.tsx handles this, don't remove it
- RLS migrations in supabase/migrations/ must be manually run in Supabase SQL editor
- completed_at = null means workout is in progress — coach route returns 400 if not finished
