# Invite Signup + Onboarding Spec

Status: proposed (not yet built)
Area: Platform (auth, first-run experience)
Author: Claude session, 2026-09-07

## Goal

Let Luka send one link to someone, have them create their own account without
his involvement, and walk them from zero to a working, populated Atlas with
their own API key in it.

Today every account is hand-created through the admin API, and a fresh account
opens onto nothing but empty states with every AI feature returning
`428 no_api_key`. This spec closes both gaps.

## Scope in one line

Invite-token signup, a guided and skippable onboarding wizard, our own API key
guide page, and a password reset that does not depend on email.

---

## Part 0: Findings that shape the design

Verified 2026-09-07 against the live project, not assumed:

1. **Supabase signups are already ENABLED** with email confirmation ON. The only
   thing making Atlas invite-only today is the `allowed_emails` check in
   `/auth/callback`. The project level is not protecting anything.
2. **Supabase's built-in email sender is unreliable** (aggressively rate
   limited, frequently spam-filed, documented by Supabase as not for
   production). Luka reports confirmation email failing previously. So **no part
   of this flow may depend on an email being delivered.**
3. **`admin.generateLink({ type: 'recovery' })` works** and returns an action
   link without sending an email. This is the password reset mechanism.

---

## Part 1: Invite link and signup

### Route: `GET /join/<token>` (public)

Must be added to the `PUBLIC_PREFIXES` bypass in `src/proxy.ts`, same as
`/demo`, or logged-out visitors get 307'd to `/login` before reaching it.

**Landing page content:**
- One short paragraph on what Atlas is.
- **"Take a look at a live demo"** button → the existing demo link. Placing the
  demo peek *here*, pre-signup, is deliberate: the demo link signs the visitor
  into the shared demo account, so offering it after signup would clobber their
  own session. Before signup there is no session to clobber.
- **"Create your account"** → reveals the signup form.

**Signup form fields:** first name, email, password, confirm password.

**`POST /api/join/<token>`** does all of this server-side:
1. Timing-safe compare of the token against `INVITE_TOKEN` env var. Reject → 403.
2. `admin.createUser({ email, password, email_confirm: true, user_metadata: { first_name } })`.
   `email_confirm: true` marks the address confirmed at creation, so **no
   confirmation email is ever sent or required.**
3. `insert into allowed_emails (email)` — the invite token is what earns the
   allowlist entry.
4. `insert into user_settings (user_id, first_name)` — drives the dashboard title.
5. Sign the new user in (`signInWithPassword`), which also overwrites any demo
   session cookie left over from the demo peek.
6. Redirect to `/onboarding`.

**Errors to handle in the UI:** email already registered, weak password
(Supabase enforces a minimum), passwords not matching, invalid token.

### Token behavior

- One shared, multi-use link. No expiry.
- Revoked by rotating `INVITE_TOKEN` in Vercel and redeploying.
- Every successful signup is logged (email + timestamp) so Luka can see who used
  the link. A small `invite_signups` table, or a structured server log line.

### Abuse controls

`/api/join/<token>` is publicly reachable and creates users. Two layers, and it
matters which one is load-bearing:

1. **Max signups per token (the real control).** A counter in the database, so
   it is global and cannot be evaded. Once the token hits its cap, every further
   signup is refused regardless of source. This is what bounds a forwarded or
   leaked link to a known number of junk accounts. Default cap: 10.
2. **Per-IP rate limit (the soft control).** Reuses the existing in-memory
   limiter. Worth having to stop casual loops, but it is **per serverless
   instance on Vercel**, so each warm instance keeps its own window and it is
   trivially evaded by spreading requests. Never rely on it as the boundary.

The token itself must be ≥32 random characters, which puts brute force out of
reach by construction and makes rate limiting a formality rather than a
dependency.

**Deliberately NOT doing: a separate human-typed invite code.** A typed code and
a URL token are the same secret with the same entropy; the only real difference
is that a URL leaks through history, `Referer`, and screenshots while a typed
code costs UX. Given the blast radius of a successful signup (a blank account,
zero access to any other user's data under RLS + audited per-user scoping, and
no usable AI without the attacker supplying their own paid API key), the extra
friction is not worth it for a link texted to known people.

#### Follow-up: typed invite code (build only when triggered)

**Trigger condition:** the link is going somewhere semi-public — a club Slack, a
group chat Luka does not control, a bio link, anything not a direct message to a
known person. Until then this is friction with no matching gain.

**When triggered, the ~20 minute add:**
- Public `/join` page (no token in the URL at all), with a code field.
- A short human-friendly code, e.g. `ATLAS-7K42`, stored as `INVITE_CODE`.
- **Rate limiting becomes load-bearing here**, not optional: a 10-character
  friendly code has orders of magnitude less entropy than a 32-char token and is
  genuinely brute-forceable. Needs a DB-backed attempt counter (per IP and
  global), not the in-memory limiter, for the same per-instance reason above.
- Constant-time compare, generic failure message, and a lockout after N failed
  attempts.
- Keep the DB signup cap regardless. It stays the real ceiling.

Do not ship the friendly code without the DB-backed attempt counter. A short
secret with only in-memory rate limiting is weaker than the URL token it
replaced, which is the failure mode worth avoiding.

---

## Part 2: Onboarding wizard

### Route: `/onboarding`

**Gating:** `user_settings` gets a new `onboarding_completed_at timestamptz`
column (migration). The home page redirects to `/onboarding` when it is null.
Finishing *or* skipping sets it. **The migration must backfill every existing
user with `now()`**, or User A, User B, User C, User D, User E, User F, and the demo
account all get thrown into onboarding on their next visit.

**Resumable:** progress persists per step, so closing the tab does not restart
it. A `onboarding_step smallint` column, or derive the step from what data
already exists (the latter is less state to keep honest).

**Every step writes real data immediately.** This is a setup flow, not a
slideshow.

**Everything after the welcome is skippable.** Forcing a six-step wizard before
someone sees the app is how you lose them. The API key banner and the existing
`428` "add your key in Settings" messaging already exist as the safety net for
anyone who skips.

### The steps

| # | Step | Writes | Skippable |
|---|------|--------|-----------|
| 1 | **Welcome** — what Atlas is, that it runs on their own API key, honest cost expectation | nothing | no (just a continue) |
| 2 | **API key** — Anthropic (needed for all coaching), OpenAI (optional: food photo + voice) | `user_secrets` via the existing `PUT /api/user/keys` | yes |
| 3 | **Health profile** — age, sex, height, weight, activity level, goal, target weight | `health_profile` | yes |
| 4 | **Calorie + protein targets** — runs the existing `/api/health/calorie-target/calculate` so they watch real targets get produced from their own numbers | `health_profile` targets | yes |
| 5 | **Starter habits** — pick from a suggested list (Make bed, Workout, Read, Meditate, Walk, Water…) or add their own | `habits` | yes |
| 6 | **Gym setup** (optional) — gyms, training days, split | `gym_config` | yes |
| 7 | **Wearable** (optional) — Connect Oura or WHOOP, single-provider rule already enforced by the callbacks | `wearable_tokens` | yes |
| 8 | **Walkthrough** — interactive coach marks, see below | `onboarding_completed_at` | finish |

**Ordering rationale:** the API key comes second because step 4 genuinely needs
it (the calorie target route is an AI call). If the key was skipped, step 4 must
degrade gracefully: either fall back to a plain Mifflin-St Jeor calculation with
no AI, or let them type targets manually. It must not show a broken AI error
inside onboarding.

### Step 8 in detail: the interactive walkthrough

Not a slideshow of screenshots. A sequence of **coach marks**: a dimmed overlay
with one real UI element spotlit, a small popover explaining it, and
Back / Next / Skip. The user is looking at their actual app the whole time.

**Anchor to the TabBar, not to page content.** The TabBar is fixed, present on
every screen, and structurally stable. Page content moves constantly (cards
reorder, empty states differ per user, the home layout is dense), so anchoring
there produces popovers pointing at the wrong thing the first time anyone
reorders a card. Anchoring to a fixed element is the difference between a tour
that survives redesigns and one that silently rots.

**Stops (5–6, keep it short):**
1. Home tab — "your day at a glance: check-in, briefing, streaks"
2. Gym tab — "log sets, the coach reads your history and tells you what to lift"
3. Health tab — "food, water, weight, sleep, supplements"
4. Journal tab — "write or talk, the AI reflects back"
5. Mentor tab — "asks about everything above at once; this is the payoff"
6. Settings link — "your API key and which AI runs it" (only if they skipped
   the key step, otherwise drop it)

**Rules:**
- **Escapable at every step.** A tour you cannot dismiss is a hostage situation.
  Skip must be visible on stop 1, not buried at the end.
- Runs once. Completion writes `onboarding_completed_at`; never auto-replays.
- Re-runnable on demand from Settings ("Replay walkthrough") so it is
  discoverable later without being forced.
- Pure UI, no data writes, no AI calls — so it works identically for a user who
  skipped the API key step.
- Mobile first: popovers must not overflow a 375px viewport, and the spotlight
  has to account for the safe-area inset above the TabBar.

**Explicitly not doing:** a tour that navigates between tabs on the user's
behalf. It sounds better and is markedly worse — it fights the router, breaks
the back button, and strands people mid-tour on a page they did not choose.

---

## Part 3: API key guide

### Route: `/guide/api-key` (public, linked from onboarding and Settings)

**Write our own page. Do not link a third-party article.** A random blog post
goes stale, shows someone else's UI, and will not cover the spend cap, which is
the part that actually protects the user.

Contents:
1. **What this is and why**: Atlas runs on Claude; you bring your own key so your
   data and billing are yours, and nothing is shared between users.
2. **Cost, stated plainly**: you pay Anthropic directly, typical use runs a few
   dollars a month, and here is how to cap it so it can never surprise you.
3. **Anthropic steps**: create an account at console.anthropic.com → add credits
   → **create a Workspace** → **set a monthly spend limit on it** → create a key
   inside that workspace → paste it into Atlas.
4. **The spend cap is presented as a required step, not an optional one.**
5. **OpenAI section** (optional, only for food photo parsing and voice notes):
   create a Project → set a project spend limit → create a key.
6. Note that Atlas stores the key encrypted and only ever shows the last four
   characters again.

Anthropic's own docs can be a secondary "official docs" link, never the primary
instruction.

---

## Part 4: Password reset without email

**Primary mechanism: Luka generates a link and texts it.** This matches how he
already operates and cannot be broken by email delivery.

- A small admin-only route or script calls
  `admin.generateLink({ type: 'recovery', email })` and returns the action link.
- Luka texts that link to the person. They click it, land on a **set a new
  password** page, and are signed in.
- New route needed: `/auth/reset` — reads the recovery token from the URL and
  submits a new password via `supabase.auth.updateUser({ password })`. Must be
  in the proxy bypass list.

**Secondary (only if built later):** a self-serve "forgot password" form calling
`resetPasswordForEmail`. Do NOT ship this as the primary path while the built-in
sender is unreliable, because a reset that silently never arrives is worse than
no reset button at all. Making it dependable requires custom SMTP (Resend or
similar), which requires a domain Luka owns. Out of scope here.

---

## Data model changes

One migration:

```sql
alter table user_settings add column if not exists onboarding_completed_at timestamptz;
-- Existing users must not be sent through onboarding
update user_settings set onboarding_completed_at = now() where onboarding_completed_at is null;
```

Plus optionally an `invite_signups` table (email, signed_up_at) for the audit log.

No changes to `user_secrets`, `health_profile`, `habits`, `gym_config`, or
`wearable_tokens` — onboarding writes through their existing APIs.

## Environment variables

```
INVITE_TOKEN    # long random string; the /join/<token> secret. Rotate to revoke.
```

Add to `.env.local` and Vercel Production.

## Out of scope

- Seeding sample data into a real user's account. It pollutes the data the AI
  reads, so the mentor would open by commenting on workouts they never did.
  The pre-signup demo peek covers "let me see it full" instead.
- Email-based signup confirmation or self-serve password reset (see Part 4).
- Custom SMTP setup.
- Any change to the existing Settings page beyond linking the new guide.

## Acceptance criteria

- A logged-out stranger opening `/join/<valid-token>` can view the demo, come
  back, create an account, and land in onboarding, without Luka doing anything.
- `/join/<wrong-token>` gives a clean rejection and creates nothing.
- No email is required at any point in signup.
- A user who skips every optional step still reaches a working Home page with
  the existing "add your API keys" banner showing.
- A user who completes every step has: their name on the dashboard, a working
  Anthropic key, calorie and protein targets, at least one habit, and
  `onboarding_completed_at` set.
- Existing users are never shown onboarding.
- Luka can mint a recovery link for any user and that link lets them set a new
  password.
- Typecheck and production build clean.

## Rough effort

Medium. Part 1 (invite + signup) and Part 4 (reset link) are small and are the
unblocking pieces. Part 2 (the wizard) is the bulk, roughly eight screens
wired to APIs that already exist. Part 3 is a static page.

**Suggested build order:** Part 1 → Part 4 → ship and send the link → Part 3 →
Part 2.
