# Fitbit Integration Spec

Status: BUILT 2026-09-08 (on the Google Health API; see "Transport" below)
Area: Health / wearables
Author: Claude session, 2026-09-08

## Transport: Google Health API, not the legacy Fitbit Web API

The first cut of this integration was written against the legacy Fitbit Web
API. Registering the app surfaced the banner nobody had seen yet: **the legacy
Fitbit Web API is turned off on 2026-09-30.** Google's replacement is the
Google Health API (`https://health.googleapis.com/v4`, Google OAuth 2.0,
docs at developers.google.com/health). The whole data layer was rebuilt
against it the same afternoon; the "Verified against Fitbit's docs" section
below is kept for the record but the field mapping and OAuth sections that
follow describe the Google Health API version, which is what shipped.

Things about the Google Health API that shape the design, verified against
the v4 discovery document (`health.googleapis.com/$discovery/rest?version=v4`)
rather than the prose docs, which disagree with each other in places:

- **Still no sleep score and no readiness score.** Same derivation as planned.
- **Sleep sessions carry `metadata.mainSleep`** (longest sleep with stages in
  a day) and a `summary` with `minutesAsleep`, `minutesInSleepPeriod` (time
  in bed), `minutesToFallAsleep` and per-stage `stagesSummary[]`. Efficiency
  is not a field; it is `minutesAsleep / minutesInSleepPeriod`.
- **Day attribution is the civil end date** (`interval.civilEndTime`), which
  is the morning you woke — Atlas's own convention. `interval.endUtcOffset`
  ("-25200s") lets `bedtime_end` keep the wearer's wall clock.
- **Daily metrics are `list` calls with a date filter**, not rollups:
  `daily-resting-heart-rate` (`beatsPerMinute`), `daily-heart-rate-variability`
  (`averageHeartRateVariabilityMilliseconds`, i.e. RMSSD),
  `daily-sleep-temperature-derivations` (`nightlyTemperatureCelsius` −
  `baselineTemperatureCelsius` = the deviation Oura exposes directly).
  `dailyRollUp` on those types returns personal *ranges*, not the day's value.
- **Steps and total calories are `dailyRollUp`** over a closed-open civil date
  range with `windowSizeDays: 1` (`steps.countSum`, `totalCalories.kcalSum`).
  `total-calories` caps the range at 14 days, which is exactly the window.
- **Sleep `list` is capped at 25 per page**, so the sync follows
  `nextPageToken`.
- **Scopes** (all three are "restricted" in Google's taxonomy):
  `googlehealth.sleep.readonly`, `googlehealth.health_metrics_and_measurements.readonly`,
  `googlehealth.activity_and_fitness.readonly`.
- **Google refresh tokens do not rotate.** The refresh response carries only a
  new access token (~1h); the refresh token lives until revoked or unused for
  six months. `access_type=offline&prompt=consent` is required to get one at
  all, and the callback refuses a token response without one rather than
  looking connected and going blank an hour later.
- **Unverified apps are capped at 100 users in BOTH Testing and Production.**
  Verification (plus the CASA security assessment) only gates the 101st user.
  But a consent screen left in **Testing** issues 7-day refresh tokens, so
  Atlas must be published to Production, unverified. Users see Google's
  "hasn't verified this app" interstitial once and click Advanced → continue.
- **Every Fitbit user already has a Google account:** the Fitbit→Google
  account migration became mandatory on 2026-05-19.

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

## OAuth (Google OAuth 2.0, PKCE + confidential client)

- `GET /api/health/fitbit/connect` — auth'd; PKCE verifier + `state` mirrored
  into httpOnly cookies (10 min); 302 to
  `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`,
  `redirect_uri={APP_URL}/api/health/fitbit/callback`, the three scopes,
  `access_type=offline`, `prompt=consent`, `code_challenge` (S256).
- `GET /api/health/fitbit/callback` — verifies state, exchanges the code at
  `https://oauth2.googleapis.com/token` (client id + secret + `code_verifier`
  in the body), refuses a response with no `refresh_token`, upserts
  `wearable_tokens` provider='fitbit', **deletes every other provider's token
  row** (one-main rule), runs a 14-day initial sync, redirects to `/health`.
- Oura and WHOOP callbacks delete every sibling (`neq('provider', self)`).
- **Token refresh:** at sync, if the access token expires within 60s, refresh
  with client id + secret; store the new access token, keep the refresh token.
  Refresh failure or all-endpoints-401 deletes the token row so the card falls
  back to Connect.
- `POST /api/health/wearables/disconnect` accepts `'fitbit'`.

## Sync (`src/features/health/fitbitSync.ts`)

`syncFitbitToday(db, userId, today, tz, force?, windowDays=3)`:
- Same 15-min cache short-circuit against the provider='fitbit' today row.
- Six calls over a 14-day closed-open civil window, in parallel: `sleep`
  (list, `sleep.interval.civil_end_time` filter, paginated), the three daily
  types (list, `{type}.date` filter), `steps` and `total-calories`
  (dailyRollUp).
- Main sleep per civil end day = `metadata.mainSleep`, else longest by
  `minutesAsleep`. Naps never win.
- Computes HRV/RHR baselines from prior days in the window, derives the two
  scores, upserts one normalized row for each of the last `windowDays` days
  that has any data.

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

## Env / Google Cloud — what Luka does

```
GOOGLE_HEALTH_CLIENT_ID
GOOGLE_HEALTH_CLIENT_SECRET
```

in `.env.local` and Vercel Production. In Google Cloud Console
(`console.cloud.google.com`), with the personal Google account:

1. **Create a project** named Atlas.
2. **Enable the API:** APIs & Services → Library → "Google Health API"
   (`health.googleapis.com`) → Enable.
3. **OAuth consent screen** (Google Auth Platform → Branding): user type
   **External**, app name Atlas, support email + developer contact = his
   email. Data Access → Add scopes → search "Google Health API" → tick the
   three `.readonly` scopes above (sleep, health metrics and measurements,
   activity and fitness).
4. **Audience → Publish app → In production.** It will warn that restricted
   scopes need verification; confirm anyway. Unverified is fine under 100
   users, and Testing status would expire everyone's token weekly. Adding the
   five circle emails as test users as well is harmless belt-and-braces.
5. **Clients → Create client → Web application**, name Atlas, Authorized
   redirect URIs: `https://atlas-phi-plum.vercel.app/api/health/fitbit/callback`
   and `http://localhost:3000/api/health/fitbit/callback`. Copy the Client ID
   and Client Secret.
6. Add the two env vars in `.env.local` and Vercel, redeploy.

**On the friend's side:** connect with the Google account their Fitbit is
signed into. Google shows "Google hasn't verified this app" once → Advanced →
"Go to Atlas (unsafe)" → tick all three permissions → Continue. HRV and skin
temperature only flow if the device supports them; without them readiness
degrades to sleep-only, which still renders.

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
