# Whoop Recovery & Sleep API — Handoff Document

## The Problem

Whoop's recovery and sleep API endpoints return HTTP 404 for every request, even with a
fresh valid token and all scopes enabled in the Whoop developer portal. The cycle endpoint
returns 200 with real data. The Whoop app itself shows a recovery score (green, ~90%), so
the data exists on Whoop's side — it just never comes through the API.

**Symptom in the app:** The health page Whoop card only shows Calories and Strain. Recovery
score, HRV, and RHR are always blank.

---

## Stack

- Next.js 16.2.6 App Router + TypeScript
- Supabase (Postgres + Auth)
- Anthropic Claude API
- Whoop Developer API v1

---

## Relevant Files

```
src/app/api/health/whoop/connect/route.ts      OAuth start — builds auth URL with scopes
src/app/api/health/whoop/callback/route.ts     OAuth callback — exchanges code for token, saves to DB
src/app/api/health/whoop/data/route.ts         GET — fetches + caches Whoop data for today
src/app/api/health/whoop/debug/route.ts        GET — diagnostic endpoint (hit while logged in)
src/app/api/health/whoop/disconnect/route.ts   DELETE — clears token + cached data
src/features/health/types.ts                   WhoopData type definition
```

---

## What Was Tried

### 1. Added missing `offline` scope to the OAuth connect URL
`src/app/api/health/whoop/connect/route.ts` — the `scope` parameter now includes `offline`:
```
offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement
```

### 2. Added JWT decode to debug endpoint
Attempted to decode the access token as a JWT to inspect scopes. Result: Whoop issues
**opaque tokens** (not JWTs). The token has 1 dot, length 87. Not decodable.

### 3. Added `diagnosis` field to debug endpoint
Debug endpoint now detects the pattern `recovery=404 + sleep=404 + cycle=200` and flags it
as a scope issue. Also surfaces refresh failures explicitly.

### 4. Built disconnect + reconnect flow
- `DELETE /api/health/whoop/disconnect` — deletes the token row and clears cached wearable_data
- "Reconnect Whoop (fixes sync issues)" button added to health settings modal (gear icon →
  scroll to bottom → Whoop section)
- Reconnecting deletes the old token and re-runs the full OAuth flow

### 5. Verified Whoop developer portal scopes
The Whoop app at https://app.whoop.com/oauth/applications shows all scopes enabled:
- ✅ read:recovery
- ✅ read:cycles
- ✅ read:sleep
- ✅ read:workout
- ✅ read:profile
- ✅ read:body_measurement

### 6. User reconnected Whoop
A fresh OAuth flow was completed. New token stored.

---

## Current State (as of last diagnosis)

### Live API test with fresh token

Direct curl calls with the stored access token:

| Endpoint | Status | Response |
|---|---|---|
| `/developer/v1/recovery?limit=3` | **404** | `HTTP 404 Not Found` |
| `/developer/v1/cycle?limit=3` | **200** | 3 records with real strain/calorie data |
| `/developer/v1/activity/sleep?limit=3` | **404** | `HTTP 404 Not Found` |
| `/developer/v1/user/profile/basic` | **200** | Real profile data |

### Token state

```
provider: whoop
expires_at: 2026-06-11T05:54:25.945+00 (fresh, not expired)
token type: opaque (not JWT, 1 dot, 87 chars)
```

### Cached wearable_data

Every stored Whoop row contains only cycle data — recovery has never been populated:

```json
{"cycle": {"strain": 9.784643, "kilojoule": 7743.6626}}
```

No `recovery` or `sleep` keys have ever appeared in any cached row.

---

## Key Diagnostic Facts

1. **Cycle works, recovery/sleep don't — consistently.** This has been true across multiple
   tokens (before and after reconnect). It is not a token expiry issue.

2. **The token is opaque.** We cannot inspect what scopes are actually embedded. Whoop's
   token introspection endpoint returns 404.

3. **Whoop uses 404 for two different things:**
   - Scope violation (missing `read:recovery` etc.) — returns `HTTP 404 Not Found`
   - No data available (device not worn for sleep) — also returns `HTTP 404 Not Found`
   The response body is identical. We cannot distinguish these two cases from the response alone.

4. **The Whoop app itself shows recovery data.** The user sees a green recovery score in
   the Whoop mobile app. So the data exists; the API is not returning it.

5. **Reconnecting did not fix it.** A full disconnect → reconnect with all scopes in the
   portal still produces the same 404 pattern.

---

## Open Hypotheses

### Hypothesis A — Whoop account/hardware tier restriction
Some Whoop API endpoints may be restricted to certain hardware versions (Whoop 4.0+) or
membership tiers. The `/v1/recovery` endpoint could require a feature that the account's
API access tier doesn't include, even when the portal scope is enabled. The 404 would be
a real "not available" not a scope error.

**How to test:** Check the Whoop developer dashboard for any tier/plan restriction on the
account. Try querying with a wider date range (`?limit=20&start=2026-01-01`). If it's
genuinely no data, it would still 404. If it's a tier issue, Whoop support would need to
unlock it.

### Hypothesis B — Scope grant not propagated to existing tokens
Adding scopes to the portal may not be sufficient — Whoop may require re-submitting the
app for approval or the scope change may not be reflected in OAuth grants until the app
is re-verified. Some OAuth providers have a delay between portal config change and when
tokens actually receive new scopes.

**How to test:** Check the Whoop developer portal for any "pending review" or "approval
required" state on the added scopes. Contact Whoop developer support.

### Hypothesis C — The Whoop v1 API recovery endpoint has a different URL
The code calls `/developer/v1/recovery`. If Whoop changed their endpoint path, this would
404 regardless of scopes. Cycle works at `/developer/v1/cycle`. Recovery and sleep may
have moved.

**How to test:** Check the current Whoop developer API documentation at
https://developer.whoop.com/api — verify that `/v1/recovery` and `/v1/activity/sleep`
are the correct current paths.

---

## Code State — Whoop Data Route

`src/app/api/health/whoop/data/route.ts` fetches three endpoints in parallel:

```typescript
const [recoveryRes, cycleRes, sleepRes] = await Promise.all([
  fetch('https://api.prod.whoop.com/developer/v1/recovery?limit=5', { headers }),
  fetch('https://api.prod.whoop.com/developer/v1/cycle?limit=5', { headers }),
  fetch('https://api.prod.whoop.com/developer/v1/activity/sleep?limit=5', { headers }),
])

if (recoveryRes.status === 404 && sleepRes.status === 404 && cycleRes.status === 200) {
  console.warn('[whoop/data] recovery+sleep both 404 while cycle OK — likely missing OAuth scopes')
}

// 401 = bad token, 404 = treated as "no data"
if (recoveryRes.status === 401 || cycleRes.status === 401 || sleepRes.status === 401) {
  return NextResponse.json({ error: 'auth' }, { status: 401 })
}
```

The `WhoopData` type:
```typescript
type WhoopData = {
  recovery?: {
    score: number | null
    hrv_rmssd_milli: number | null
    resting_heart_rate: number | null
  }
  cycle?: {
    strain: number | null
    kilojoule: number | null
  }
  sleep?: {
    duration_seconds: number | null
  }
}
```

---

## Recommended Next Steps

1. **Check Hypothesis C first** — verify the endpoint URLs in current Whoop API docs.
   If `/v1/recovery` has moved or been renamed, that's the fix.

2. **Check Hypothesis A** — query with a very wide date range and see if any data ever
   comes back. Also check the Whoop developer portal for account/tier info.

3. **Contact Whoop developer support** if the above don't pan out. The symptom
   (cycle=200, recovery=404, all scopes enabled, fresh token) is unusual enough that
   it may be an account-level configuration issue on Whoop's backend.

4. **Debug endpoint** is live at `/api/health/whoop/debug` — hit this while logged in
   for the freshest diagnostic snapshot including token expiry state and live API responses.
