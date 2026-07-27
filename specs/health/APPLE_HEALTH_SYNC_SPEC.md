# Apple Health Sync — Easy Onboarding + Scheduled Steps

**Status:** §6 code built + shipped 2026-07-26 (steps_day, steps-tile priority +
"yesterday" caption, AppleHealthCard simple/advanced flow). Waiting on Luka for
§8: the master Shortcut's iCloud link → `APPLE_SYNC_SHORTCUT_URL` in
[AppleHealthCard.tsx](../../src/app/health/AppleHealthCard.tsx) (the "Add to
iPhone" button stays hidden until the link is set).

Make Apple Health sync (steps, active energy, VO₂ max) something a non-technical
family member — Luka's dad — can turn on in a few taps, and keep it running on a
schedule without ever opening the Shortcut again. Then surface **today's** steps
on the wearables card instead of Oura's day-lagged number.

This is **Option A** from the design conversation: a pre-built iOS Shortcut
distributed by iCloud link, run automatically by iOS Automations. We explicitly
did **not** pick Option B (a native Capacitor wrapper + TestFlight). Native is the
only path to a true Whoop-style "Allow Health" sheet, but it's the wrong amount of
overhead for a handful of family accounts. Nothing here blocks going native later.

---

## 1. Why this exists

Two problems, one root:

1. **Onboarding is too hard.** The current setup ([AppleHealthCard.tsx](../../src/app/health/AppleHealthCard.tsx))
   hands the user three URLs + a token and tells them to *build* two Shortcuts by
   hand ("Find Health Samples for Steps… POST to the Sync-in URL, header
   `Authorization: Bearer <token>`…"). That's fine for Luka, impossible for his dad.

2. **Steps show yesterday, not today.** Oura finalizes its `daily_activity`
   summary late in the day, so today's step total doesn't exist in Oura's cloud
   until evening. The wearables tile therefore shows yesterday's completed count
   all morning ([ouraSync.ts](../../src/features/health/ouraSync.ts) now grabs the
   latest-available activity day). The **only** source with a live *today* step
   count is the phone itself (Apple Health), which means the fix for "today's
   steps" is the same as the fix for onboarding: get a live Apple sync running.

**Hard constraint that frames everything:** Atlas is a web PWA. There is no web
HealthKit API — a website can never read Apple Health directly, and Atlas can
never *pull*. The phone must *push*, and the only push mechanism available to a
non-native app is the Shortcuts app. So the design is "make the push effortless
and automatic," not "add a connect button that reads Health."

---

## 2. What already exists (reuse, don't rebuild)

The entire server + data pipeline is already built and working. This spec is
mostly **onboarding UX + one client-side tile tweak**. Confirmed pieces:

- **Sync-in route** — `POST /api/health/apple/sync` ([route.ts](../../src/app/api/health/apple/sync/route.ts)).
  Body `{ date?, steps?, active_calories?, vo2_max?, workouts? }`. Partial merge:
  only overwrites fields that were sent, so running it many times a day is safe and
  never clobbers yesterday (it keys on the calendar date, not the 3 AM roll-over).
- **Write-back route** — `GET /api/health/apple/export` (body weight + nutrition back
  out to Health). Optional, separate concern; keep as-is.
- **Status route** — `GET /api/health/apple/status` ([route.ts](../../src/app/api/health/apple/status/route.ts))
  returns `{ daysOfData, lastSync, todaySteps, latest{date,steps,active_calories,vo2_max}, recentWorkouts }`.
- **Token auth** — [`userIdFromSyncToken`](../../src/lib/appleAuth.ts) accepts **either**
  `Authorization: Bearer <token>` **or** a `?token=<token>` query param. The token
  lives in `user_settings.sync_token`, minted by `POST /api/user/api-token`
  ([route.ts](../../src/app/api/user/api-token/route.ts)).
- **Proxy bypass** — [`proxy.ts`](../../src/proxy.ts) already lists both
  `/api/health/apple/sync` and `/api/health/apple/export` in `TOKEN_AUTHED_PATHS`,
  so token-authed calls with no session cookie return 200, not a 307-to-login.
- **Client hook + card** — `useAppleHealth(today)` → `AppleHealthStatus`
  ([queries.ts](../../src/features/health/queries.ts)); the wearables Apple Watch
  card + Steps tile live in `WearablesSection`
  ([HealthClient.tsx](../../src/app/health/HealthClient.tsx)).
- **Table** — `apple_health_logs` (PK `user_id,date`; steps, active_calories,
  vo2_max, synced_at) + `apple_workouts`. **No migration needed.**

The `?token=` query-param support is the linchpin of the easy flow: it means the
Shortcut never has to set a header — the whole call is one URL.

---

## 3. The onboarding flow (target experience)

What Luka's dad actually does, start to finish:

1. Open Atlas → **Health → Settings → Apple Health**.
2. Tap **"Add to iPhone"** → opens the pre-built iCloud Shortcut link → iOS shows
   **"Add Shortcut."** One tap.
3. On add, the Shortcut's **import question** asks for the Atlas token. Dad taps
   **"Copy token"** in Atlas (right next to the button), pastes it in. Done once.
4. First run, iOS shows the native **"Allow '…' to access Health?"** sheet → Allow.
5. Atlas shows the scheduling step: **"Run this automatically 4×/day"** with the
   exact automation recipe (§5). Dad sets it up once.

After that he never touches it again. Steps appear on his dashboard, kept current
through the day.

Two-to-four taps + one paste + one Allow, versus building a Shortcut from scratch.

---

## 4. The master Shortcut (Luka builds once)

**Luka must author this once on his iPhone and give me the iCloud share link.**
Claude cannot create Shortcuts — they're built in the iOS Shortcuts app and shared
as static iCloud URLs (`https://www.icloud.com/shortcuts/<id>`).

### 4.1 "Atlas — Sync Health" (sync-in, the important one)

Actions, in order:

1. **Text** action holding the token → set as an **Import Question** ("Paste your
   Atlas sync token") so each family member fills in their own on add. Save to a
   variable `Token`. *(Alternative: store the token in a Shortcut "Ask Each Time"
   the first run only. Import question is cleaner — it runs at add-time, not run-time.)*
2. **Find Health Samples** → Steps → **Today** → **Calculate Statistics: Sum** →
   variable `Steps`.
3. **Find Health Samples** → Active Energy → **Today** → **Sum** → variable `ActiveCal`.
4. *(optional)* **Find Health Samples** → VO₂ Max → **Latest 1** → variable `VO2`.
5. **Dictionary**: `{ steps: Steps, active_calories: ActiveCal, vo2_max: VO2 }`.
6. **Get Contents of URL**:
   - URL: `https://<atlas-origin>/api/health/apple/sync?token=[Token]`
   - Method: **POST**
   - Request Body: **JSON** = the Dictionary from step 5.
7. *(optional)* Show/Notify on failure only — silent on success so the automation
   doesn't nag.

No `Authorization` header, no manual body assembly by the user — the token rides in
the query string, everything else is fixed.

### 4.2 "Atlas — Write Health Back" (optional, existing)

The current write-back Shortcut (GET `/api/health/apple/export`, log
`body_weight.value` as Body Mass, `nutrition.*` as Dietary Energy/Protein) stays as
an **advanced/optional** second Shortcut. Not part of the core "get my dad's steps
showing" goal; keep its instructions in the collapsible advanced section.

### 4.3 Origin note

The Shortcut hard-codes the production origin (the live Vercel URL). Preview/branch
URLs change per deploy, so the shared Shortcut must point at the stable prod domain.

---

## 5. Scheduling (iOS Automations — no manual runs)

The Shortcut runs itself via **personal Automations** (Shortcuts app → Automation
tab), which is separate from the Shortcut and is where "run on a schedule" lives.

**Recommendation: 4 time-of-day automations at 8am / 12pm / 4pm / 8pm**, each:
- Trigger: **Time of Day**, repeat **Daily**.
- Action: **Run Shortcut → "Atlas — Sync Health."**
- **"Run Immediately" ON** (no notification, no tap — silent background run).

Rationale:
- iOS has **no native "every hour" trigger** — a time automation fires once/day.
  Hourly would mean ~12 separate automations for negligible benefit. Four keeps
  today's count **≤ ~4h stale**, which is plenty for a dashboard.
- The 8pm run captures a near-final daily total; the daytime runs give "today so
  far."
- Trivial battery, one-time setup. The partial-merge sync route makes extra runs
  free of risk, so a user who wants fresher data just adds more time slots.

**Honest caveat to surface in the UI:** background time automations run even when
locked, but iOS doesn't guarantee exact timing — a run can be a few minutes late or
skip under Low Power Mode. Irrelevant for step counts.

For Luka specifically: he already has a working Shortcut, so he likely needs
**only** to add these 4 automations — no rebuild.

---

## 6. Atlas code changes

### 6.1 AppleHealthCard settings panel — simplify + link out

[AppleHealthCard.tsx](../../src/app/health/AppleHealthCard.tsx). Restructure into a
**simple path** (default) and an **advanced path** (collapsible, today's raw
URLs/manual guide):

- Add a constant `APPLE_SYNC_SHORTCUT_URL` (the iCloud link Luka provides). If it's
  unset/empty, hide the "Add to iPhone" button and fall back to today's manual
  guide (so the feature degrades gracefully before the link exists).
- Primary CTA: **"Add to iPhone"** → `window.open(APPLE_SYNC_SHORTCUT_URL)`, shown
  next to a prominent **"Copy token"** button (reuse `CopyRow`, but promote the
  token copy to a one-tap primary rather than buried in the guide).
- Below it: the **4-automation scheduling recipe** as a short numbered list
  (§5), with the timing caveat.
- Collapse the current three-URL manual guide + write-back instructions under a
  **"Advanced / build it yourself"** disclosure for power users. Nothing there is
  deleted — just demoted.
- Token generation (`genToken`) is unchanged; still auto-generated on first setup.

### 6.2 Steps tile — prefer today's steps

[HealthClient.tsx](../../src/app/health/HealthClient.tsx), `WearablesSection`.
Current value:
```ts
const ouraSteps = oura?.activity?.steps ?? (hasApple ? appleLatest?.steps ?? null : null)
```
New priority — **prefer a source that is definitely today's**, then fall back:
```ts
// Apple synced today = a live, real today count (iPhone counts in real time).
const appleToday = apple?.latest?.date === today ? (apple.latest.steps ?? null) : null
// Oura steps are latest-available (today only after Oura finalizes in the evening,
// else yesterday). steps_day tells us which — see 6.3.
const ouraIsToday = oura?.activity?.steps_day === today
const stepsToday = appleToday ?? (ouraIsToday ? oura?.activity?.steps ?? null : null)
const stepsValue = stepsToday ?? oura?.activity?.steps ?? (hasApple ? appleLatest?.steps ?? null : null)
const stepsAreToday = stepsToday != null
```
Render: show `fmtInt(stepsValue)`, and when `!stepsAreToday && stepsValue != null`,
show a tiny muted caption **"yesterday"** under the number. This kills the "it's a
little weird" confusion — the number is always honestly labeled, and it upgrades to
today's automatically the moment either source has today's data.

### 6.3 Record which day Oura's steps are for

[ouraSync.ts](../../src/features/health/ouraSync.ts) + [types.ts](../../src/features/health/types.ts).
The sync now picks the latest-available activity day but doesn't record which day
that was, so the client can't tell today from yesterday. Add `steps_day` to the
activity blob:
```ts
// types.ts — OuraData.activity
activity?: {
  steps: number | null
  active_calories: number | null
  total_calories: number | null
  steps_day?: string | null   // YYYY-MM-DD the steps/calories belong to
}
```
```ts
// ouraSync.ts — where activity is selected
steps_day: typeof activity?.day === 'string' ? activity.day : null,
```
Backfill isn't required — old rows just read `steps_day == null` (treated as
not-today, shows the "yesterday" caption conservatively) until the next sync
overwrites them.

### 6.4 No changes to

Sync route, export route, status route, proxy bypass, token auth, DB schema,
Apple Watch card gating (the ≤3-day freshness gate stays).

---

## 7. Edge cases

- **Token in a shared iCloud Shortcut** — one static link is shared by the whole
  family; the import question makes each install carry its own token. A regenerated
  token (Regenerate button) means re-adding the Shortcut or editing the token
  variable — call this out in the UI.
- **Query-param token in logs** — the token appears in the URL query string. It's a
  low-value, user-regenerable, single-purpose token (only writes that user's Health
  rows, no read of anything sensitive), and the Bearer-header path stays available
  for the advanced Shortcut. Acceptable; note it in the spec, don't block on it.
- **VO₂ Max often absent** — many people have no recent VO₂ Max sample; the tile
  already renders `--` and the sync treats it as optional. Fine.
- **Dad has no Oura** — the Apple Watch card (steps/active-cal/VO₂) shows on its own
  once his sync is fresh; the Oura card shows its "Connect" state. Independent.
- **Automation didn't run** — `lastSync` relative time is already shown; if it goes
  stale the Apple card's freshness gate hides it and the "yesterday" caption tells
  the truth. No false "today."
- **Timezone** — sync route stamps the date via the user's tz already; no change.

---

## 8. What Luka must provide before/at implementation

1. **Build the master Shortcut** (§4.1) on his iPhone and send the **iCloud share
   link** → becomes `APPLE_SYNC_SHORTCUT_URL`.
2. Confirm the **production origin** to hard-code in the Shortcut URL.
3. *(optional)* Build/share the write-back Shortcut link too, if we want that in the
   simple flow rather than advanced.

Implementation of §6 (the Atlas code) can proceed with a placeholder link and the
"Add to iPhone" button hidden until the real link lands.

---

## 9. Implementation order

1. **types.ts + ouraSync.ts** — add `activity.steps_day` (§6.3). Smallest, unblocks
   the tile logic. Verify a fresh Oura pull writes `steps_day`.
2. **HealthClient.tsx** — steps-tile priority + "yesterday" caption (§6.2). Verify
   against Luka's data (Oura yesterday → caption shows; once Apple-today exists →
   caption gone).
3. **AppleHealthCard.tsx** — simple/advanced restructure, "Add to iPhone" +
   promoted "Copy token" + scheduling recipe (§6.1). Guard on `APPLE_SYNC_SHORTCUT_URL`.
4. **Wire the real iCloud link** once Luka provides it; unhide the button.
5. Ship to `main` (prod), then Luka + dad walk the §3 flow on real phones.

`tsc --noEmit` + `npm run build` clean at each step. No DB migration.

---

## 10. Verification checklist

- [ ] Fresh Oura pull stores `activity.steps_day` = the day the steps are for.
- [ ] Morning: tile shows Oura's yesterday steps **with** a muted "yesterday" tag.
- [ ] After a same-day Apple sync: tile shows today's Apple steps, **no** tag, and
      prefers Apple over Oura.
- [ ] Evening (Oura finalizes today): tile shows today's Oura steps, no tag.
- [ ] "Add to iPhone" opens the iCloud link; "Copy token" copies; button hidden when
      the link constant is empty.
- [ ] Advanced disclosure still exposes the raw URLs + write-back guide.
- [ ] Dad's phone: add Shortcut → paste token → Allow Health → 4 automations →
      steps appear and stay current with no manual runs.
- [ ] Apple Watch card still hidden when the latest sync is >3 days old.
