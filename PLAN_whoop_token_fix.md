# Plan: Fix Whoop Token Expiry + Refresh Failure

## Root Cause (confirmed via direct API calls + debug endpoint)

The stored Whoop token is expired (`token_expired: true`). The refresh token is also
invalid — calling Whoop's token endpoint with the stored refresh token returns:

```json
{ "error": "invalid_request", "error_description": "...missing a required parameter..." }
```

This means `refreshWhoopToken()` silently returns `null`, the data route returns 401,
and the UI shows "Connecting…" forever or an error state. There are three compounding issues:

1. **Refresh token itself is bad.** Whoop refresh tokens expire after ~30 days of inactivity
   or get invalidated when a new OAuth flow completes. The stored one is dead.
   **Fix: reconnect manually via the Reconnect Whoop button in settings.**

2. **Refresh logic doesn't log failures.** When the refresh API returns an error,
   the current code does `if (!res.ok) return null` with no logging. Silent failures
   make this impossible to diagnose without a debug endpoint.
   **Fix: log the refresh failure response body.**

3. **Debug route refreshes in memory but never saves to DB.** The debug endpoint re-uses
   the new access token for the test calls but throws it away, so the DB still has the
   expired token afterward. The data route then tries to refresh again and hits the same
   dead refresh token.
   **Fix: save the refreshed token in the debug route too (or just reuse refreshWhoopToken).**

4. **Token scope issue is still present.** Even after reconnecting, recovery/sleep will
   still 404 until the Whoop developer portal app has `read:recovery`, `read:sleep`,
   and `read:workout` enabled in its scope configuration.
   **Fix: update the Whoop developer portal app, then reconnect.**

---

## Action Plan

### Step 0 — Update Whoop developer portal (manual, blocking)

Go to https://app.whoop.com/oauth/applications, edit the app, and ensure these scopes
are enabled in the app config:

- `offline`
- `read:recovery`
- `read:sleep`
- `read:workout`
- `read:cycles`
- `read:profile`
- `read:body_measurement`

Without this, a reconnect will get a new token but it still won't have recovery/sleep.

### Step 1 — Reconnect Whoop (manual, after Step 0)

Open Health → Settings gear → "Reconnect Whoop (fixes sync issues)". This deletes the
dead token and goes through the OAuth flow fresh, getting a token with all scopes.

### Step 2 — Fix refresh logging in data route

**File:** `src/app/api/health/whoop/data/route.ts`

In `refreshWhoopToken`, log the failure response so it's visible in Vercel logs:

```typescript
if (!res.ok) {
  const body = await res.text().catch(() => '')
  console.error('[whoop] refresh token failed:', res.status, body)
  return null
}
```

### Step 3 — Fix debug route to save refreshed token

**File:** `src/app/api/health/whoop/debug/route.ts`

Replace the inline refresh block with a call to a shared helper that saves to DB,
or save the refreshed token explicitly:

```typescript
if (new Date(tokenRow.expires_at) <= new Date()) {
  const refreshRes = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
      client_id: process.env.WHOOP_CLIENT_ID!,
      client_secret: process.env.WHOOP_CLIENT_SECRET!,
    }),
  })
  if (refreshRes.ok) {
    const tokens = await refreshRes.json()
    accessToken = tokens.access_token
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
    // Save to DB so the data route benefits too
    await db.from('wearable_tokens').update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    }).eq('user_id', user.id).eq('provider', 'whoop')
  } else {
    const errBody = await refreshRes.text().catch(() => '')
    console.error('[whoop/debug] refresh failed:', refreshRes.status, errBody)
    // Surface this in the debug response
    return NextResponse.json({
      token_expires_at: tokenRow.expires_at,
      token_expired: true,
      refresh_failed: true,
      refresh_error: errBody,
      diagnosis: 'Token expired and refresh failed. Use Reconnect Whoop in settings.',
    })
  }
}
```

### Step 4 — Verify

After reconnecting (Steps 0–1) and deploying the code fixes (Steps 2–3):

1. Hit `/api/health/whoop/debug`
2. Confirm `token_expired: false`
3. Confirm `diagnosis: "OK"` 
4. Confirm recovery, cycle, sleep all return `status: 200`
5. Reload the health page — recovery score, HRV, and RHR should display

---

## Summary

The code fix (Steps 2–3) is straightforward logging + saving improvements.
But they don't unblock you right now — Step 0 (portal scopes) and Step 1 (reconnect)
are both required first, and Step 0 must happen in the Whoop developer portal before
Step 1 will work correctly.
