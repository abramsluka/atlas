# Spec: Atlas MCP Server — Claude Tools over Remote MCP

> **For the implementing agent:** This is an executable spec. Read it fully, then implement in the
> phase order given. Every referenced file path is real and was verified against the codebase on
> 2026-07-07. Follow the existing patterns named here — do not invent new architecture. When this
> spec and the codebase disagree on a detail (a column name, a helper signature), trust the
> codebase and keep moving. Next.js here is **v16.2.6** — read the relevant guides in
> `node_modules/next/dist/docs/` before writing route handlers (per `AGENTS.md`).

## Goal

Expose Atlas as a remote MCP server at `https://<prod-domain>/api/mcp` (Streamable HTTP) so every
Claude client can read and write Atlas data mid-conversation:

- **Claude Code** — connects with a static bearer token (works at end of Phase 2).
- **claude.ai web / mobile / Claude Desktop** — connects as a **custom connector**, which requires
  OAuth 2.1 (Phase 3). Once connected on web, the tools are available in the iPhone app too —
  that's the headline use case: *"log a chicken burrito, ~800 cal, 45g protein"* from the Claude
  app anywhere, and it lands in Atlas.

Claude does its own macro estimation in-conversation — tools accept explicit values and never call
OpenAI/Anthropic themselves. Tools are thin, validated wrappers over the same Supabase writes the
app already does.

## Decisions already made (do not relitigate)

1. Lives in the Atlas repo, deployed with the app on Vercel. No separate service.
2. OAuth is built in this project (Phase 3), not deferred — Luka wants all clients working.
   Identity = the existing Supabase Auth session; Atlas acts as its own small authorization server.
3. Single-user app in practice, but every token resolves to a `user_id` and every query scopes
   `.eq('user_id', userId)` — same as every existing route.
4. Whoop/Oura write-back is out of scope permanently (their APIs are read-only).

## Existing Code Map (read these before writing)

| Path | What it is |
|---|---|
| `src/lib/appleAuth.ts` | `userIdFromSyncToken(req)` — Bearer token → `user_settings.sync_token` → `user_id`. The auth pattern to generalize. |
| `src/app/api/user/api-token/route.ts` | Mints/rotates the `atlas_...` sync token. Reuse this token as the Phase 2 static credential — do not invent a second static token. |
| `src/app/api/health/food/log/route.ts` | Canonical text-entry food insert: `rolledDate` 4am boundary, hydrating-drink → `water_logs` side effect, `food_items` frequents upsert. **Extract its core into a shared helper** (Phase 2) rather than duplicating. |
| `src/app/api/health/water/route.ts`, `.../caffeine/route.ts`, `.../supplement-logs/route.ts`, `src/app/api/gym/bodyweight/route.ts`, `src/app/api/gym/logs/route.ts`, `src/app/api/journal/route.ts`, `src/app/api/mentor/jots/route.ts` | Canonical insert shapes for each write tool. |
| `src/app/api/mentor/chat/route.ts` (~lines 258–284) | The 12-source parallel aggregation. Model `get_daily_summary` on a subset of this. |
| `src/lib/supabase/server.ts` | `createClient()` (auth only) / `createServiceClient()` (all DB work). |
| `src/lib/getUserTimezone.ts` | `getUserTimezone(userId)` → IANA tz from `user_settings`, `'UTC'` fallback. |
| `src/features/food/date.ts` | `rolledDate` — food's 4am-rolled date. |
| `src/proxy.ts` | Next 16 proxy. **Redirects ALL unauthenticated requests to `/login`, including API routes**, except a hardcoded `TOKEN_AUTHED_PATHS` list. Must be updated (Phase 2/3) or every MCP/OAuth request 307s to the login page. |

## Architecture

```
Claude client ──HTTPS──▶ /api/mcp  (Streamable HTTP, JSON-RPC)
                           │  Authorization: Bearer <token>
                           ▼
                 resolveMcpUser(token) ─▶ user_id
                   ├─ 'atlas_…'      → user_settings.sync_token   (static, Phase 2)
                   └─ 'atlas_mcp_…'  → mcp_tokens (hashed, OAuth) (Phase 3)
                           ▼
                 tool handlers → createServiceClient() → existing tables
```

- **Library:** use [`mcp-handler`](https://github.com/vercel/mcp-handler) (Vercel's adapter) +
  existing `zod` (already at `^4.4.3` — check mcp-handler's zod peer range; if it wants zod v3,
  pin the tool schemas accordingly or fall back). **Verify at build start** that `mcp-handler`
  installs and runs against Next 16.2.6. Fallback if it fights Next 16: hand-roll the route with
  `@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport` in stateless mode. Do not use the
  SSE legacy transport; no Redis needed.
- **Route:** `src/app/api/mcp/[transport]/route.ts` (mcp-handler convention; the public endpoint
  is `/api/mcp`). `export const runtime = 'nodejs'`; `export const maxDuration = 60`.
- **Stateless:** every request re-authenticates via the Bearer token. No sessions.

### Date handling (applies to all tools)

Helper `todayFor(userId)`: `getUserTimezone(userId)` → format current date `YYYY-MM-DD` in that tz
(`Intl.DateTimeFormat('en-CA', { timeZone })`). Every dated tool takes an optional `date`
(`YYYY-MM-DD`) defaulting to this. Exception: `log_food` uses the `rolledDate` 4am boundary via the
shared food helper, matching the app.

---

## Phase 1 — Database

New migration `supabase/migrations/<today>000001_mcp_server.sql`:

```sql
-- OAuth clients (dynamic client registration; public clients, PKCE-only)
create table if not exists mcp_clients (
  client_id     uuid primary key default gen_random_uuid(),
  client_name   text,
  redirect_uris jsonb not null default '[]',
  created_at    timestamptz not null default now()
);

-- Single-use authorization codes
create table if not exists mcp_auth_codes (
  code_hash      text primary key,             -- sha256 hex of the code
  client_id      uuid not null references mcp_clients(client_id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  redirect_uri   text not null,
  code_challenge text not null,                -- PKCE, S256 only
  expires_at     timestamptz not null,         -- now() + 10 min
  used_at        timestamptz
);

-- Access + refresh tokens (store hashes, never raw tokens)
create table if not exists mcp_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  client_id  uuid references mcp_clients(client_id) on delete cascade,
  kind       text not null check (kind in ('access','refresh')),
  token_hash text not null unique,             -- sha256 hex
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mcp_tokens_user on mcp_tokens (user_id, created_at desc);
```

No RLS policies needed beyond enabling RLS for hygiene (`enable row level security` on all three,
no policies) — these tables are only ever touched via `createServiceClient()`.

**Reminder:** migrations are NOT auto-applied. Run it per the project's psql flow (see
`CLAUDE_CODE_MEMORY.md` / feedback_migrations memory), or tell Luka which file to run.

---

## Phase 2 — MCP endpoint + tools (usable from Claude Code at end of this phase)

### 2a. Auth resolution

`src/lib/mcpAuth.ts`:

```ts
// Returns user_id or null. Two token families:
//  'atlas_'      → user_settings.sync_token (exact match, no expiry — existing behavior)
//  'atlas_mcp_'  → mcp_tokens where kind='access', token_hash=sha256(token),
//                  revoked_at is null, expires_at > now()
export async function resolveMcpUser(authHeader: string | null): Promise<string | null>
```

Generalize from `src/lib/appleAuth.ts` (header parsing) — don't modify that file.

### 2b. Proxy bypass

In `src/proxy.ts`, skip the login redirect for the new public surface. Replace the exact-match
check with a prefix-aware one:

```ts
const TOKEN_AUTHED_PATHS = ['/api/health/apple/sync', '/api/health/apple/export']
const PUBLIC_PREFIXES = ['/api/mcp', '/api/oauth', '/.well-known']
// bypass when TOKEN_AUTHED_PATHS.includes(pathname) || PUBLIC_PREFIXES.some(p => pathname.startsWith(p))
```

### 2c. The route + tools

`src/app/api/mcp/[transport]/route.ts` via `createMcpHandler` (or the SDK fallback). Wrap with
auth: on missing/invalid token return **401 with**
`WWW-Authenticate: Bearer resource_metadata="https://<prod-domain>/.well-known/oauth-protected-resource"`
(mcp-handler's `withMcpAuth` supports this shape; header must be present even in Phase 2 — it's
what makes claude.ai start the OAuth dance in Phase 3, and Claude Code with a bearer header never
sees it).

Extract the food-log core (rolledDate, insert, water side effect, `food_items` upsert) from
`src/app/api/health/food/log/route.ts` into `src/features/food/logFoodServer.ts` and have both the
existing route and the MCP tool call it. Behavior of the existing route must not change.

**Tools (v1 — 12).** Descriptions are load-bearing: the model reads them to decide when to call.
Use these strings verbatim (tune only if testing shows misfires).

| Tool | Inputs (zod) | Behavior | Description string |
|---|---|---|---|
| `log_food` | `item_name: string`, `calories: number`, `protein_g: number`, `carbs_g: number`, `notes?: string`, `is_drink?: boolean`, `volume_oz?: number` | Shared helper. `source: is_drink ? 'drink' : 'text'`, `confidence: 'medium'`, `storage_path: null`. Returns saved entry + new day totals. | "Log food or a caloric drink the user consumed. Call this when the user mentions eating or drinking something and wants it tracked. Estimate calories, protein_g and carbs_g yourself before calling (Atlas does not track fat). For drinks, set is_drink and volume_oz." |
| `log_water` | `amount_oz: number`, `date?: string` | Insert `water_logs { user_id, date, amount_oz }` (date is TEXT). Return day total. | "Log plain water intake in ounces. Call when the user mentions drinking water. For caloric or hydrating drinks (juice, protein shake), use log_food with is_drink instead." |
| `log_weight` | `weight: number`, `date?: string` | Upsert `body_weights { user_id, date_key, weight }` `onConflict: 'user_id,date_key'`. Weight is lbs. | "Record the user's body weight in pounds for a date (default today). Overwrites that day's entry." |
| `log_caffeine` | `amount_mg: number`, `source: string`, `date?: string` | Insert `caffeine_logs { user_id, date, source, amount_mg }`. Return day total mg. | "Log caffeine intake. Call when the user mentions coffee, espresso, tea, an energy drink or pre-workout. Estimate amount_mg from the drink if not stated (coffee ≈ 95mg, espresso shot ≈ 65mg, energy drink ≈ 160mg)." |
| `log_supplement` | `name: string`, `time_slot?: 'morning'\|'lunch'\|'evening'\|'anytime'`, `date?: string` | `ilike` lookup on `supplements` (`active = true`). No match → return the active list in the error so the model can retry. Insert `supplement_logs`; on unique violation `(supplement_id, date, time_slot)` return "already logged" (not an error). Default slot `'anytime'`. | "Mark one of the user's configured supplements as taken. Call when the user says they took a supplement (creatine, vitamin D, etc.). Uses fuzzy name matching against their supplement list." |
| `log_gym_set` | `exercise: string`, `weight: number`, `reps: number` | `ilike` lookup on `gym_exercises`. 0 or >1 matches → return candidate names in the error. Insert `gym_logs { user_id, exercise_id, weight, reps }` (validate: reps int > 0, weight ≥ 0 — the existing route has NO validation; do not copy that). | "Log one completed set of a gym exercise (weight in lbs, reps). Call once per set when the user reports lifting. Exercise must match one they've configured; on ambiguity you'll get candidates back." |
| `add_jot` | `content: string` | Insert `jots { user_id, content: content.trim() }`. | "Save a quick thought, idea or note to the user's jots inbox. Call when the user says 'jot this down', 'note this', or shares a passing thought they want captured." |
| `add_journal_entry` | `body: string`, `mood?: number (1-5)`, `title?: string` | Insert `journal_entries { user_id, date, title, body, mood }` (column is `body`, NOT `content`). | "Create a journal entry. Call when the user wants to journal or reflect at length — for short passing thoughts use add_jot instead. mood is 1 (low) to 5 (great)." |
| `get_daily_summary` | `date?: string` | Parallel fetch, modeled on `mentor/chat`: `wearable_data` (oura + whoop for date — JSON paths per `src/features/health/types.ts`), food entries + kcal/protein/carb totals, water total, caffeine total, latest `body_weights` ≤ date, `supplement_logs` (join `supplements(name)`) vs configured, `daily_checkins`, `gym_logs` (join `gym_exercises(name)`) for the day, `apple_health_logs` steps. Return one compact JSON object; omit empty sections. | "Get the user's full day snapshot: sleep and recovery (Oura/Whoop), food and macros, water, caffeine, weight, supplements taken, gym sets, steps and check-ins. Call for questions like 'how am I doing today' or before giving any health/coaching commentary." |
| `get_food_history` | `days?: number (default 7, max 30)` | Per-day totals (kcal, protein, carbs) + item names from `food_logs`. | "Get daily food totals and items for the last N days. Call for questions about eating patterns, calorie/protein averages or trends." |
| `get_gym_progress` | `exercise?: string` | With `exercise`: last 15 `gym_logs` + heaviest set ever. Without: all `gym_exercises` with their most recent set. | "Get strength-training history. Call for questions like 'what's my bench at' or 'when did I last train'. Omit exercise to list all exercises with their latest set." |
| `get_journal_recent` | `limit?: number (default 5, max 20)` | Recent `journal_entries`: `date, title, mood`, `body` truncated to 500 chars. | "Get the user's recent journal entries (most recent first, bodies truncated). Call when conversation touches on how they've been feeling or what's been on their mind." |

Every tool result: `content: [{ type: 'text', text: JSON.stringify(result) }]`. Errors: return
`isError: true` with a message the model can act on — never throw raw.

**Server metadata:** name `atlas`, instructions string: "Atlas is Luka's personal life-OS (fitness,
nutrition, sleep, journaling). Dates are YYYY-MM-DD in the user's timezone. Weights lbs, water oz,
caffeine mg. Atlas tracks calories/protein/carbs only (no fat)."

### 2d. Phase 2 verification gate

1. `npx @modelcontextprotocol/inspector` against local dev with `Authorization: Bearer <sync_token>` — all 12 tools list and run.
2. `claude mcp add --transport http atlas https://<prod-domain>/api/mcp --header "Authorization: Bearer <sync_token>"` → in a Claude Code session: log water, run `get_daily_summary`, verify rows in Supabase.
3. Unauthenticated POST to `/api/mcp` returns **401 + WWW-Authenticate** (not a 307 to /login).

---

## Phase 3 — OAuth 2.1 (unlocks claude.ai / Desktop / mobile custom connector)

Atlas is both **resource server** (`/api/mcp`) and **authorization server**. Verified requirements
(May 2026): authorization-code + PKCE (S256, mandatory), refresh tokens, DCR supported, client
secret optional for public clients. Claude refreshes proactively ~5 min before expiry and on 401.

**Issuer/base URL:** check `.env.local` for an existing canonical app-URL var; if none, add
`NEXT_PUBLIC_APP_URL=https://<prod-domain>` and use it everywhere below (never derive from request
Host).

### Redirect URI allowlist (exact-match, plus loopback exception)

- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback` (verify at build; harmless if unused)
- Loopback for Claude Code OAuth: `http://localhost/callback` and `http://127.0.0.1/callback`
  with **port-agnostic matching** (compare scheme+host+path, ignore port). No other http URIs.
  Validate DCR-submitted `redirect_uris` against these same rules at registration time.

### Endpoints

| Route | File | Behavior |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | `src/app/.well-known/oauth-protected-resource/route.ts` | RFC 9728: `{ resource: "<APP_URL>/api/mcp", authorization_servers: ["<APP_URL>"], scopes_supported: ["atlas:full"], bearer_methods_supported: ["header"] }`. Also serve the path-suffixed variant `/.well-known/oauth-protected-resource/api/mcp` (Claude probes it first) — a nested `route.ts` returning the same JSON. |
| `GET /.well-known/oauth-authorization-server` | same pattern | RFC 8414: issuer `<APP_URL>`, `authorization_endpoint: <APP_URL>/oauth/authorize`, `token_endpoint: <APP_URL>/api/oauth/token`, `registration_endpoint: <APP_URL>/api/oauth/register`, `response_types_supported: ["code"]`, `grant_types_supported: ["authorization_code","refresh_token"]`, `code_challenge_methods_supported: ["S256"]`, `token_endpoint_auth_methods_supported: ["none"]`, `scopes_supported: ["atlas:full"]`. |
| `POST /api/oauth/register` | `src/app/api/oauth/register/route.ts` | DCR (RFC 7591). Accept `client_name`, `redirect_uris[]`; validate URIs against allowlist rules; insert `mcp_clients`; return `{ client_id, client_name, redirect_uris, token_endpoint_auth_method: "none" }`. Public clients only — no secret issued. |
| `GET /oauth/authorize` | `src/app/oauth/authorize/page.tsx` (page, not API — needs the Supabase session cookie) | Validate `client_id` exists, `redirect_uri` allowed for it, `response_type=code`, `code_challenge` + `code_challenge_method=S256` present, capture `state`. Invalid client/redirect → render error page (never redirect). Valid → render consent card (app style: client name, tool summary, Approve / Deny). Approve (server action): mint 32-byte code `crypto.randomBytes`, store sha256 in `mcp_auth_codes` (10 min expiry), 302 to `redirect_uri?code=...&state=...`. Deny → `redirect_uri?error=access_denied&state=...`. |
| `POST /api/oauth/token` | `src/app/api/oauth/token/route.ts` | Form-encoded. `grant_type=authorization_code`: look up sha256(code) — must be unused, unexpired, client_id + redirect_uri match; verify PKCE `sha256(code_verifier) base64url == code_challenge`; mark used; issue tokens. `grant_type=refresh_token`: validate hash, kind='refresh', not revoked/expired; **rotate** (revoke old refresh, issue new pair). Response: `{ access_token, token_type: "Bearer", expires_in: 3600, refresh_token, scope: "atlas:full" }`. Errors per RFC 6749 (`invalid_grant`, 400). |

**Token format:** access `atlas_mcp_<48 hex>` (1 h TTL), refresh `atlas_ref_<48 hex>` (90 d TTL),
both stored as sha256 hashes in `mcp_tokens`.

**Login redirect continuity:** the proxy currently drops the original URL when bouncing to
`/login`. For `/oauth/authorize` only, append `?next=<encoded path+query>` in the proxy redirect,
and make the login page honor a **same-origin, path-only** `next` param after successful sign-in.
Touch nothing else about the login flow.

### Phase 3 verification gate

1. claude.ai → Settings → Connectors → Add custom connector → `https://<prod-domain>/api/mcp`
   (no client ID/secret — DCR handles it) → browser lands on Atlas consent page → Approve →
   connector shows connected.
2. In a claude.ai chat: enable the connector, "log 16oz of water" → row appears; `get_daily_summary` returns data. Repeat once from the iPhone app.
3. Confirm refresh: shorten access TTL to 2 min locally, verify Claude transparently refreshes.
4. Negative tests: tampered `code_verifier` → `invalid_grant`; reused code → `invalid_grant`; unregistered redirect_uri → error page, no redirect.

---

## Phase 4 — Settings surface (small)

In the existing settings UI (where the Apple Health sync token lives), add an "MCP / Claude"
card: show endpoint URL, the existing sync token (reuse the current reveal/regenerate UI),
connected OAuth clients (`mcp_clients` joined to latest token `created_at`) with a **Revoke**
button (sets `revoked_at` on all that client's tokens and deletes the client). Match existing
card styling; no new design system.

---

## Gotchas (verified against the codebase — do not "fix" these, conform to them)

- `food_logs`: name column is **`item_name`**; there is **no fat column** (calories/protein_g/carbs_g only); `storage_path` must be explicitly `null`; day boundary is `rolledDate` (4am), not midnight.
- `water_logs`, `caffeine_logs`, `supplement_logs` `date` columns are **TEXT**, not date type. `journal_entries.date` and `food_logs.date` are real dates.
- Body weight = **`body_weights`** with **`date_key`** (text) + **`weight`** (numeric, lbs), upsert `onConflict: 'user_id,date_key'`.
- Journal text column is **`body`**, not `content` (there is a known pre-existing bug elsewhere selecting `content` — do not replicate).
- Oura/Whoop live in one shared **`wearable_data`** table: PK `(user_id, provider, date)`, payload in `data` jsonb. Shapes in `src/features/health/types.ts` (`OuraData`, `WhoopData`).
- Gym model is `gym_exercises` + **`gym_logs` (one row per set)**. The legacy `workouts`/`exercises`/`sets` tables from the old logger exist but new tools must not touch them.
- `daily_checkins` and `user_settings` have **no migration files** (created out-of-band) — don't try to migrate them; column lists are in the code map sources.
- `src/proxy.ts` login-redirects unauthenticated API requests — Phase 2b bypass is mandatory, and `/.well-known` + `/api/oauth` + `/oauth/authorize`(unauthed → login+next) must be reachable.
- Service-role client bypasses RLS — `resolveMcpUser` is the entire security boundary. Every tool query must scope by the resolved `user_id`.
- Avoid legacy `goals` / `habit_logs` / `debloat_logs` tables in summaries (UI removed).
- Vercel: keep responses JSON (no long-lived SSE); `maxDuration = 60` on the MCP route.

## Out of scope (v1)

Pushing data out to Whoop/Oura (their APIs are read-only). Photo-based food logging via MCP.
Multi-user consent hardening beyond the above. Rate limiting (note as follow-up). MCP resources/
prompts (tools only). Editing/deleting entries via MCP.

## Done means

All Phase 2 and Phase 3 verification gates pass against **production**, the migration is applied,
and `CLAUDE_CODE_MEMORY.md` is checkpointed with the endpoint URL, auth model, and any deviations
from this spec.
