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

### Gym — current model (what the Gym tab uses)

**`gym_config`** — one row per user (unique user_id): gyms jsonb, days jsonb, split_rotation, units, upgrade_at_reps

**`gym_exercises`** — id, user_id, name, gym_id, day_id, bodyweight, start_weight, rep_min, rep_max, step, order_index

**`gym_logs`** — ONE ROW PER SET: id, user_id, exercise_id (FK → gym_exercises), weight, reps, logged_at

### Gym — legacy workout logger (live at /workouts, do NOT extend)

**`workouts`** / **`exercises`** / **`sets`** / **`workout_coach_responses`** — the original logger's tables (user_id NOT NULL on exercises and sets). New gym features target the gym_* tables above, never these.

### Wearables

**`wearable_data`** — provider-agnostic table, PK (user_id, provider, date); the whole payload is a `data` jsonb blob, with no per-provider tables and no typed sleep/readiness columns. **Only Oura is actually implemented.** The `provider` key leaves room for other sources, but there is NO Whoop code anywhere in `src/` — the `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET` env vars are unused leftovers and there is no `WhoopData` type. Oura's shape lives in `src/features/health/types.ts` (`OuraData`). OAuth tokens in **`wearable_tokens`** (PK user_id, provider). Apple Health also feeds in via the iOS Shortcut sync (`apple_health_logs` / `apple_workouts`), separate from this table.

### Other

**`daily_checkins`** — id, user_id, date (YYYY-MM-DD), morning_planned_training, morning_intent, evening_actual_training, evening_reflection. No migration file — created out-of-band in the dashboard (same for `user_settings`).

Health/food/journal tables (food_logs, water_logs, body_weights, caffeine_logs, supplements, supplement_logs, journal_entries, jots, apple_health_logs, apple_workouts) are defined in `supabase/migrations/` and their exact column gotchas are mapped in `specs/platform/MCP_SERVER_SPEC.md` → Gotchas.

**RLS:** Enabled on all tables. API routes bypass it via createServiceClient().

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SECRETS_ENCRYPTION_KEY   # 32-byte base64; encrypts per-user API keys in user_secrets
```

**AI keys are per-user (BYOK), not env vars.** Every user stores their own Anthropic +
OpenAI key via /settings → `user_secrets` (AES-256-GCM, RLS with no policies). All AI
routes resolve clients through `getAnthropicForUser()` / `getOpenAIForUser()` and return
428 `no_api_key` when unset. There is NO global ANTHROPIC_API_KEY/OPENAI_API_KEY fallback
in app code (the env vars remain only for scripts/ CLI tools).

After changing .env.local, always restart the dev server.

## Security Posture & Threat Model

Atlas is **invite-only for a small circle (~5 family/friends)**, NOT a public SaaS. Accounts are created by hand (Supabase admin API + the `allowed_emails` gate); there is no self-serve signup. Judge all security advice through that lens — generic "harden your SaaS" checklists mostly do not apply here.

**Already handled — do NOT redo, migrate, or "upgrade":**
- **Auth:** Supabase Auth *is* a real, production auth provider — do NOT migrate to Clerk/Firebase (a pointless rewrite that fights the Postgres/RLS setup). Login is rate-limited by Supabase; signup is closed/allowlisted.
- **Data isolation:** RLS enabled on every table; API routes bypass RLS via the service client and enforce per-user scoping in code — audited across all ~112 routes, 0 cross-user leaks (2026-07). `user_secrets` is policy-less on purpose (server-only).
- **Secrets:** all server-side env vars; per-user AI keys AES-256-GCM encrypted in `user_secrets`, never sent to the browser (only last-4). Only `NEXT_PUBLIC_{SUPABASE_URL,SUPABASE_ANON_KEY,APP_URL}` reach the client — all safe to be public. Verified 2026-07: no server secret in any client bundle.

**Deliberately deferred — premature at this scale.** Revisit ONLY if Atlas opens to public self-serve signup (that flips the threat model): Redis/response caching, async job queues for AI (Atlas AI is interactive + streamed by design), load testing.

**The one optional guardrail with real value:** a light *per-user* rate limit on the expensive streaming AI routes — protects a friend's own capped budget from a runaway client loop. Cost is otherwise already bounded by per-user Anthropic/OpenAI spend caps.

**Discipline that DOES matter:** the app-layer per-user scoping is what actually protects data — re-audit route scoping whenever new API routes are added.

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

src/proxy.ts                        # Next.js 16 middleware (session refresh + login redirect)
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
- Deployed to production on Vercel (live) — real mobile perf should be tested against the prod URL, not the local `next dev` server

## What's Next

1. **Home page redesign (Phase 2)**

2. **Gym page redesign (Phase 2)**

3. **Health page redesign (Phase 2)**

4. **Mentor + Journal visual polish (Phase 2)**

5. **Phase 3 — Polish and motion**

## Deferred (don't build unless asked)

Finances/subscriptions tab, goals module.

## Committing — multiple agents may share this tree

Several Claude agents (and Luka) can be working in this repo at once. EVERY commit
or push must follow the `/commit-mine` skill (`.claude/skills/commit-mine/`),
whether or not it is mentioned: stage only files you created or edited this
session, by explicit path. Never `git add -A` / `git add .` / `commit -a`. Leave
every change you did not make — including untracked files you didn't create —
sitting in the tree for its owner to commit, and never stash, restore, or clean
someone else's changes.

## Deploying — production only builds from main

Vercel builds Production ONLY from `main`. Pushes to `claude/*` session branches
create Preview deployments; the live app does not change. After the final push of
any session on a `claude/*` branch, land it on main:

```bash
git fetch origin && git merge origin/main --no-edit && git push origin HEAD:main
```

If the merge conflicts, resolve it in the session branch first, then push both the
branch and main. Never end a session with shipped work sitting only on a preview
branch — that is how fixes silently never reach the PWA.

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
- `src/proxy.ts` login-redirects EVERY unauthenticated request to /login — including API routes. Any endpoint that must work without a session cookie (token-authed sync routes, MCP, OAuth, .well-known) must be added to its bypass lists, or callers get a 307 to /login instead of a 401
