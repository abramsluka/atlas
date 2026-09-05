# WHOOP Integration Spec (rebuild)

Status: approved by Luka, building now
Area: Health / wearables
Author: Claude session, 2026-09-05

## Goal

Bring WHOOP back as a first-class wearable next to Oura. A user connects ONE
main wearable: both connect options show up front when nothing is connected,
the connected provider becomes the main card, and switching (or disconnecting)
lives in the Health settings sheet. Luka's friend wears a WHOOP, so the data
pipeline gets a real tester this time.

## Why the old one died

The previous integration mapped WHOOP data ad hoc and half the fields never
rendered ("recovery + sleep still dashes" in old notes) before it was ripped
out. Zero Whoop code exists today; only `wearable_tokens` / `wearable_data`
(provider-keyed by design) and the `WHOOP_CLIENT_ID`/`WHOOP_CLIENT_SECRET` env
vars remain. The dev-portal app is alive: prod callback URL registered
(`/api/health/whoop/callback`), scopes granted (recovery, cycles, sleep,
workout, profile, body_measurement), 10-test-user dev mode, 100 req/min.

## Core design decision: normalize at sync time

WHOOP data is normalized into the exact `OuraData` shape (the blob every
consumer already renders) and stored as `wearable_data` rows with
`provider='whoop'`. Downstream consumers (health card, energy curve, mentor,
briefing, gym program, assistant) keep their logic; they only need to read the
ACTIVE provider instead of the literal `'oura'`.

Field mapping (WHOOP v2 API → OuraData):

| OuraData field | WHOOP source |
|---|---|
| sleep.score | sleep `score.sleep_performance_percentage` |
| sleep.total_sleep_duration (sec) | stage_summary (light + slow_wave + rem) / 1000 |
| sleep.deep_sleep_duration (sec) | stage_summary total_slow_wave_sleep_time_milli / 1000 |
| sleep.rem_sleep_duration (sec) | stage_summary total_rem_sleep_time_milli / 1000 |
| sleep.efficiency | score.sleep_efficiency_percentage |
| sleep.latency | null (WHOOP doesn't expose it) |
| sleep.average_hrv | recovery `score.hrv_rmssd_milli` |
| sleep.resting_heart_rate | recovery `score.resting_heart_rate` |
| sleep.bedtime_end | sleep record `end` |
| sleep.score_day / detail_day | local day of sleep `end` (via record timezone_offset) |
| readiness.score | recovery `score.recovery_score` (0-100, same scale) |
| readiness.temperature_deviation | null (WHOOP gives absolute skin temp, not deviation) |
| activity.total_calories | cycle `score.kilojoule` / 4.184, rounded |
| activity.active_calories | null |
| activity.steps | null — WHOOP does not track steps; the steps tile already prefers same-day Apple Health and shows '--' otherwise |
| activity.steps_day | cycle day |

Extra: the raw strain (`cycle.score.strain`) is stored alongside under
`data.whoop = { strain }` for future use; nothing renders it in v1.

## OAuth (mirrors Oura's connect/callback, plus WHOOP quirks)

- `GET /api/health/whoop/connect` — auth'd; 302 to
  `https://api.prod.whoop.com/oauth/oauth2/auth` with client_id, redirect_uri
  (`{appUrl}/api/health/whoop/callback`, must byte-match the portal entry),
  `scope=offline read:recovery read:sleep read:cycles`, and a random `state`
  (WHOOP REQUIRES state, min 8 chars) mirrored into an httpOnly cookie.
- `GET /api/health/whoop/callback` — verifies state cookie, exchanges the code
  at `https://api.prod.whoop.com/oauth/oauth2/token` (form-encoded), upserts
  `wearable_tokens` provider='whoop', DELETES the oura token row (one-main
  rule), runs an initial 7-day sync, redirects to /health.
- The Oura callback gets the mirrored rule: connecting Oura deletes the whoop
  token row.
- **Token refresh:** WHOOP access tokens live ~1h and refresh tokens ROTATE —
  every refresh returns a new refresh_token that must be persisted immediately
  (`scope=offline` is what grants refresh tokens at all). Refresh failure or
  all-endpoints-401 deletes the token row so the UI falls back to Connect,
  same as ouraSync's 401 rule.
- `POST /api/health/wearables/disconnect` `{ provider }` — deletes that token
  row, keeps historical data. Used by the settings sheet.

## Sync (`src/features/health/whoopSync.ts`, mirrors ouraSync)

`syncWhoopToday(db, userId, today, force?, windowDays=3)`:
- Same 15-min cache TTL short-circuit against the provider='whoop' row.
- Fetches `/developer/v2/activity/sleep`, `/developer/v2/recovery`,
  `/developer/v2/cycle` for the window (paginated, `records`/`next_token`).
- Day attribution: a sleep belongs to the local day of its `end` (record
  timezone_offset), naps (`nap: true`) never win over the main sleep;
  recovery joins its sleep via `sleep_id`; cycle joins by day.
- Upserts a normalized row for EVERY full day in the window (this is the
  backfill; the callback's first sync uses windowDays=7).
- `score_state !== 'SCORED'` fields stay null rather than guessing.

## Active-provider resolution

New helper `src/features/health/wearableProvider.ts`:
`getActiveWearableProvider(db, userId)` → `'whoop' | 'oura' | null` from the
single `wearable_tokens` row (callbacks enforce single-row). Consumers that
`.eq('provider', 'oura')` switch to the resolved provider (default 'oura' when
null so cached history still renders). Touched read sites: health/page,
caffeine/page, ouraContext (context + range), oura/data route (dispatches to
whichever sync), oura/history route, home/coach, home/todays-call,
assistant/chat, gym/program/generate. The oura/debug route stays Oura-only.

## UI (HealthClient)

- **WearablesSection, nothing connected:** two buttons — "Connect Oura Ring"
  and "Connect WHOOP" (hrefs to the two connect routes).
- **Connected:** existing card, same fields (identical data shape), title
  "Oura Ring" or "WHOOP"; readiness row keeps its label in v1.
- **Settings sheet → Wearables:** shows the active provider, a "Switch to
  WHOOP/Oura" link (other provider's connect route — the switch IS the
  one-main rule, enforced server-side in the callbacks), and Disconnect.

## Env / portal

- `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` already in `.env.local`; **must be
  added to Vercel Production** (Luka, dashboard) — without them the connect
  route 500s in prod.
- Local-dev OAuth needs `http://localhost:3000/api/health/whoop/callback`
  added as a second redirect URL in the WHOOP portal (optional; prod-only
  testing is fine).
- Dev-mode app: max 10 WHOOP members may connect — fine for the invite circle.

## Acceptance

- Fresh user sees both connect buttons; completing WHOOP OAuth lands back on
  /health with the WHOOP card showing real sleep/recovery within one sync.
- Connecting one provider removes the other's token (single active provider);
  switching back works; disconnect returns to the two-button state.
- All AI surfaces (briefing, mentor, health coach) read the WHOOP-normalized
  data with zero prompt/format changes.
- Typecheck + build clean; no regression for Oura-connected users (Luka).

## Out of scope (v1)

Strain display/tile, WHOOP workouts → gym integration, webhooks (polling TTL
is fine at this scale), body measurements, showing both providers at once.
