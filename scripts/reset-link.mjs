#!/usr/bin/env node
// Mint a password-reset link for a user and print it. Send it to them directly
// (text/DM) — this deliberately does NOT rely on email, because Supabase's
// built-in sender is rate-limited and frequently spam-filed.
//
//   node scripts/reset-link.mjs someone@example.com
//
// The link is single-use and expires (Supabase default ~1 hour). It lands on
// /auth/callback, which exchanges the code and forwards to /auth/reset where
// they set a new password.

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const require = createRequire(join(root, '/'))
const { createClient } = require('@supabase/supabase-js')

const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
)

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/reset-link.mjs <email>')
  process.exit(1)
}

const appUrl = process.env.APP_URL || env.NEXT_PUBLIC_APP_URL || 'https://atlas-phi-plum.vercel.app'
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const { data, error } = await admin.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo: `${appUrl}/auth/callback?next=/auth/reset` },
})

if (error) {
  console.error('Failed:', error.message)
  process.exit(1)
}

console.log(`\nPassword reset link for ${email}:\n`)
console.log(data.properties.action_link)
console.log('\nSingle use, expires in about an hour. Send it directly.\n')
