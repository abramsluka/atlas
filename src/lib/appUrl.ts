// Canonical public base URL — the OAuth issuer. Never derive this from request
// headers (Host / X-Forwarded-* are caller-controlled). Dev sets
// NEXT_PUBLIC_APP_URL in .env.local; Vercel prod falls back to the production
// domain so no dashboard env var is required.
export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://atlas-phi-plum.vercel.app').replace(/\/$/, '')
