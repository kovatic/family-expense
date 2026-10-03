import { createHash, randomBytes } from 'node:crypto'
import { db, ensureSchema } from '@/lib/db'
import { flatten } from './text'
import { loadContext, processEmail, type Outcome } from './pipeline'
import type { EmailMessage } from './types'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

// Each member gets one secret for their phone's Shortcut. Only its hash is stored, so it is
// shown once; creating a new one invalidates the old.
export async function createSmsToken(userId: number) {
  await ensureSchema()
  const token = `sms_${randomBytes(24).toString('base64url')}`
  await db()`
    INSERT INTO sms_ingest_tokens (user_id, token_hash) VALUES (${userId}, ${sha256(token)})
    ON CONFLICT (user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = now(), last_used_at = NULL`
  return token
}

export async function userForSmsToken(token: string | null) {
  if (!token || !token.startsWith('sms_')) return null
  await ensureSchema()
  const [row] = await db()`
    UPDATE sms_ingest_tokens SET last_used_at = now() WHERE token_hash = ${sha256(token)} RETURNING user_id`
  return (row?.user_id as number | undefined) ?? null
}

// OTPs and login codes share sender IDs with transaction alerts. Anything that carries a
// code next to OTP-like wording is refused and never stored, even if the phone's filter lets
// it through. A bare "never share your OTP" disclaimer in a transaction alert is fine.
const CODE_WORDS = String.raw`(?:otp|one[\s-]?time\s+pass(?:word|code)?|verification\s+code|passcode|security\s+code)`
export function looksSensitive(text: string) {
  return (
    new RegExp(String.raw`\b${CODE_WORDS}\b.{0,40}?\b\d{4,8}\b`, 'i').test(text) ||
    new RegExp(String.raw`\b\d{4,8}\b.{0,30}?\b${CODE_WORDS}\b`, 'i').test(text)
  )
}

export type SmsResult = Outcome | { status: 'REJECTED'; bank: null }

export async function ingestSms(userId: number, sender: string, message: string, receivedAt = new Date()): Promise<SmsResult> {
  const text = flatten(message)
  if (!text || looksSensitive(text)) return { status: 'REJECTED', bank: null }
  const cleanSender = sender.replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'unknown'
  const sms: EmailMessage = {
    source: 'SMS',
    // The same SMS forwarded twice (automation re-run) gets the same id.
    id: `sms:${sha256(text).slice(0, 40)}`,
    threadId: null,
    from: `sms:${cleanSender}`,
    subject: `SMS from ${cleanSender}`,
    receivedAt,
    text,
  }
  const ctx = await loadContext(userId)
  const outcome = await processEmail(ctx, sms)
  console.info(`[sms-import] user=${userId} sender=${cleanSender} status=${outcome.status}`)
  return outcome
}
