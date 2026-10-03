import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

// AES-256-GCM for OAuth tokens at rest. Uses GMAIL_TOKEN_ENCRYPTION_KEY (32 bytes, base64)
// when set, otherwise a key derived from AUTH_SECRET. Changing either key means every
// member has to reconnect Gmail.
function key() {
  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY
  if (raw) {
    const k = Buffer.from(raw, 'base64')
    if (k.length !== 32) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
    return k
  }
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return Buffer.from(hkdfSync('sha256', secret, 'family-expense', 'gmail-token-v1', 32))
}

export function encryptToken(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':')
}

export function decryptToken(stored: string) {
  const [version, iv, tag, data] = stored.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unrecognised token format')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
}
