import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

// AES-256-GCM for per-user API keys at rest (user_secrets table).
// SECRETS_ENCRYPTION_KEY is a 32-byte base64 secret that lives only in env —
// a DB leak alone never exposes plaintext keys.
// Wire format: base64( iv[12] || authTag[16] || ciphertext ).

function encryptionKey(): Buffer {
  const raw = process.env.SECRETS_ENCRYPTION_KEY
  if (!raw) throw new Error('SECRETS_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('SECRETS_ENCRYPTION_KEY must be 32 bytes base64')
  return key
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
