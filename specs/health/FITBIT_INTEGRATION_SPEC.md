# Fitbit Integration Spec

Status: approved by Luka, building now
Area: Health / wearables
Author: Claude session, 2026-09-08

## Goal

Fitbit becomes the third main wearable next to Oura and WHOOP. A friend of
Luka's wears one, and the invite circle is growing, so "whatever you wear,
Atlas can read it" has to actually be true. Same rules as WHOOP: one main
wearable per user, all three connect options up front, switch or disconnect
from the Health settings sheet, and zero changes to any consumer that renders
or reasons about wearable data.

## What was verified against Fitbit's docs (2026-09-08, not assumed)

1. **The Web API has no sleep score and no readiness score.** Quoting the
   sleep endpoint docs: "Sleep score is not supported through the Web API."
   Daily Readiness is a Premium, app-only feature with no endpoint at all.
   This is the single fact that shapes this design; see "Derived scores".
2. **Refresh tokens are single-use.** "The refresh token can only be used
   once, as a new refresh token is returned with the new access token." Same
   rotation hazard as WHOOP, handled the same way.
3. **Access tokens live 8 hours** (`expires_in: 28800`).
4. **Server-type apps authenticate the token endpoint with HTTP Basic**
   (`base64(client_id:client_secret)`). PKCE is recommended for all types and
   we use it as well; belt and braces.
5. **Everything Atlas needs is a daily summary.** None of the endpoints below
   require the intraday access form. Fitbit does the day attribution for us:
   `dateOfSleep` is "the date the sleep log ended", which is exactly the
   convention Atlas already uses (sleep belongs to the morning you woke).
6. **Rate limit is 150 requests per hour per user.** A sync is 6 requests, and
   the existing 15-minute cache bounds it to 24 syncs/hour worst case.
7. **Units: omit `Accept-Language` and the API returns metric**, so skin
   temperature deltas arrive in °C, matching Oura's `temperature_deviation`.
8. **Application type must be Server, not Personal.** Personal apps are
   "restricted to developer's own Fitbit account only", which would make the
   integration useless for the friend it exists for.

## Core design decision: normalize at sync time (same as WHOOP)

Fitbit data is normalized into the `OuraData` shape and stored in
`wearable_data` with `provider='fitbit'`. Every consumer (health card, energy
curve, mentor, briefing, today's call, gym program, assistant) keeps its logic.

Field mapping (Fitbit Web API → OuraData). Six calls per sync, each a date
range, so cost does not grow with the window:

| OuraData field | Fitbit source | Endpoint |
|---|---|---|
| sleep.score | **derived** (see below) | — |
| sleep.total_sleep_duration (s) | `minutesAsleep` × 60 | `/1.2/user/-/sleep/date/{start}/{end}.json` |
| sleep.deep_sleep_duration (s) | `levels.summary.deep.minutes` × 60 (stages logs only) | same |
| sleep.rem_sleep_duration (s) | `levels.summary.rem.minutes` × 60 (stages logs only) | same |
| sleep.latency (s) | `minutesToFallAsleep` × 60 | same |
| sleep.efficiency | `efficiency`, else round(100 × minutesAsleep / timeInBed) | same |
| sleep.bedtime_end | `endTime` (local wall clock) re-emitted with the user's UTC offset | same |
| sleep.score_day / detail_day | `dateOfSleep` | same |
| sleep.average_hrv (ms) | `hrv[].value.dailyRmssd` | `/1/user/-/hrv/date/{start}/{end}.json` |
| sleep.resting_heart_rate | `activities-heart[].value.restingHeartRate` | `/1/user/-/activities/heart/date/{start}/{end}.json` |
| readiness.score | **derived** (see below) | — |
| readiness.temperature_deviation (°C) | `tempSkin[].value.nightlyRelative` | `/1/user/-/temp/skin/date/{start}/{end}.json` |
| activity.steps | `activities-steps[].value` (string → int) | `/1/user/-/activities/steps/date/{start}/{end}.json` |
| activity.total_calories | `activities-calories[].value` (includes BMR, like Oura) | `/1/user/-/activities/calories/date/{start}/{end}.json` |
| activity.active_calories | null in v1 (a 7th call; not worth it) | — |
| activity.steps_day | the row's day | — |

Main sleep per day = the `isMainSleep` log for that `dateOfSleep`, else the
longest. HRV is RMSSD in milliseconds on both platforms, so it maps directly.

Extra, stored under `data.fitbit`:
`{ scores_estimated: true, log_type: 'stages' | 'classic' | null, hrv_baseline, rhr_baseline }`.
`scores_estimated` is what the UI reads to label the two headline numbers.

## Derived scores — the part that needs to be honest

WHOOP v1 died because the card showed dashes for the headline numbers. If
Fitbit's sleep and readiness are simply null, the same thing happens: the two
biggest numbers on the card are `--` forever and every AI surface says "no
wearable data". So Atlas computes both, from the same inputs Oura's own
composites use, with the formulas written down here and the result labeled
**est.** in the UI. Estimated and labeled beats blank.

**Sleep score (0–100)**, from the main sleep log:

```
stages log:   50·min(1, asleep/480) + 25·(eff/100) + 25·min(1, (deep+rem)/(0.45·asleep))
classic log:  65·min(1, asleep/480) + 35·(eff/100)
```

8 hours asleep is full duration credit; 45% of sleep in deep+REM is full
depth credit (typical adult range is 35–45%). A normal good night lands
around 80–90, a rough one around 50–60, which is the range Oura users are
used to reading.

**Readiness (0–100)**, null when there is no sleep log for the day:

```
hrvAdj  = clamp((hrv − hrvBaseline) / hrvBaseline, −0.3, 0.3) · 50     → ±15, 0 if no baseline
rhrAdj  = clamp((rhrBaseline − rhr) / rhrBaseline, −0.15, 0.15) · 100  → ±15, 0 if no baseline
tempAdj = nightlyRelative > 0.5 °C ? −10 : 0                            (elevated temp = illness signal)
readiness = clamp(round(0.6·sleepScore + 30 + hrvAdj + rhrAdj + tempAdj), 0, 100)
```

Baselines are the mean of the prior days in the fetched window that have a
value, requiring at least 3. That is why the sync always fetches a 14-day
window even when it only writes 3 days of rows: the baseline needs history.
With no baseline yet (first few days), readiness is purely sleep-driven,
which is the right degradation. Devices without HRV or a temperature sensor
simply contribute nothing to those terms.

## OAuth (mirrors WHOOP, plus Fitbit specifics)

- `GET /api/health/fitbit/connect` — auth'd; generates a PKCE verifier and a
  `state`, mirrors both into httpOnly cookies (10 min), 302s to
  `https://www.fitbit.com/oauth2/authorize` with `response_type=code`,
  `client_id`, `redirect_uri={APP_URL}/api/health/fitbit/callback`,
  `scope=sleep heartrate activity temperature profile`, `state`,
  `code_challenge` (S256). The redirect URI must byte-match the portal entry.
- `GET /api/health/fitbit/callback` — verifies state, exchanges the code at
  `https://api.fitbit.com/oauth2/token` with `Authorization: Basic` and
  `code_verifier`, upserts `wearable_tokens` provider='fitbit', **deletes
  every other provider's token row** (one-main rule), runs a 14-day initial
  sync, redirects to `/health`.
- The Oura and WHOOP callbacks get the mirrored rule: they now delete every
  sibling row (`neq('provider', self)`) instead of naming one.
- **Token refresh:** at sync, if the access token expires within 60s, refresh
  with Basic auth; persist BOTH new tokens immediately (single-use refresh).
  Refresh failure or all-endpoints-401 deletes the token row so the card
  falls back to Connect, same as the other two.
- `POST /api/health/wearables/disconnect` accepts `'fitbit'`.

## Sync (`src/features/health/fitbitSync.ts`)

`syncFitbitToday(db, userId, today, tz, force?, windowDays=3)`:
- Same 15-min cache short-circuit against the provider='fitbit' today row.
- Fetches the six range endpoints above for `max(windowDays, 14)` days in
  parallel, keyed by `dateTime` / `dateOfSleep`.
- Computes baselines, derives the two scores, upserts one normalized row for
  each of the last `windowDays` days that has any data.
- `bedtime_end`: Fitbit gives a naive local timestamp. It is re-emitted with
  the user's Atlas timezone offset for that instant (`date-fns-tz`), so the
  existing `plausibleWakeHour` reads the wall clock straight off it.

## Active-provider resolution — de-duplicated while adding the third

`WearableProvider` becomes `'oura' | 'whoop' | 'fitbit'`. Three places had
their own copy of the "which token row wins" priority (`wearableProvider.ts`,
`health/page.tsx`, `caffeine/page.tsx`); with three providers that is three
places to get out of sync, so the pure `resolveWearableProvider(rows)` moves
into `wearableProvider.ts` and the pages call it. Same for the labels: the
`isWhoop ? 'WHOOP' : 'Oura'` ternaries in home/coach, todays-call and
assistant/chat become one `WEARABLE_LABEL` table. Every
`.in('provider', ['oura','whoop'])` reads an exported `WEARABLE_PROVIDERS`.

**Bug fixed on the way:** `typicalWake.ts` hard-coded `provider='oura'`, so a
WHOOP wearer's median wake hour was silently computed from no rows. It now
uses the active provider.

Priority when a legacy account holds multiple rows: fitbit > whoop > oura
(newest integration wins, as before).

## UI

- **WearablesSection, nothing connected:** three buttons, Oura / WHOOP /
  Fitbit.
- **Connected card:** title "Fitbit". Readiness and Sleep show a small
  **est.** suffix when `data.fitbit.scores_estimated` is set. Nothing else
  changes.
- **Settings sheet → Wearables:** three "Use …" links plus Disconnect.
- **Onboarding step 7 (wearable):** third button, "Connect Fitbit", using the
  same complete-then-leave pattern as the other two.
- **Home coach / today's call / assistant:** say "Fitbit readiness (estimated)"
  so the model does not present a derived number as a device reading.

## Env / portal — what Luka does

```
FITBIT_CLIENT_ID
FITBIT_CLIENT_SECRET
```

in `.env.local` and Vercel Production. Register the app at
`https://dev.fitbit.com/apps/new` (needs a plain Google account; Workspace
accounts are not accepted):

| Field | Value |
|---|---|
| Application Name | Atlas |
| Description | Personal health dashboard |
| Application Website URL | `https://atlas-phi-plum.vercel.app` |
| Organization | Atlas |
| Organization Website URL | `https://atlas-phi-plum.vercel.app` |
| Terms of Service URL | `https://atlas-phi-plum.vercel.app/guide/api-key` (any https URL on the app is accepted) |
| Privacy Policy URL | same |
| OAuth 2.0 Application Type | **Server** |
| Redirect URL | `https://atlas-phi-plum.vercel.app/api/health/fitbit/callback` (add `http://localhost:3000/api/health/fitbit/callback` on a second line for local testing) |
| Default Access Type | **Read Only** |

Copy the OAuth 2.0 Client ID and Client Secret from the app page.

**On the friend's side:** HRV and skin temperature only flow if the "Health
Metrics" tile is enabled in their Fitbit app and the device supports it
(Sense / Versa 3+ / Charge 5+ / Inspire 3 for HRV; Sense / Charge 5+ for
temperature). Without them readiness degrades to sleep-only, which still
renders.

## Acceptance

- Fresh user sees three connect buttons; completing Fitbit OAuth lands on
  /health with the Fitbit card showing real sleep, HRV, RHR, steps and the two
  estimated scores labeled est., within one sync.
- 14 days of history render in the chart immediately after connecting.
- Connecting Fitbit removes any Oura/WHOOP token; connecting either of those
  removes Fitbit; disconnect returns to the three-button state.
- Every AI surface names the device correctly and flags readiness as
  estimated.
- Existing Oura (Luka) and WHOOP users: zero behaviour change. Typecheck and
  build clean.

## Out of scope (v1)

Fitbit workouts → gym, SpO2 / breathing rate (no OuraData slot), webhooks
(subscriptions need a verification endpoint; polling is fine at this scale),
active calories, weight sync from Fitbit Aria scales.
