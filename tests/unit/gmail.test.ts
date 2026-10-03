import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { decryptToken, encryptToken } from '@/lib/gmail/crypto'
import { fetchWithRetry, GoogleApiError, retryPolicy } from '@/lib/gmail/http'

const realFetch = globalThis.fetch
beforeEach(() => {
  process.env.AUTH_SECRET = 'test-secret'
  delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY
  retryPolicy.baseDelayMs = 1
})
afterEach(() => {
  globalThis.fetch = realFetch
})

test('tokens round-trip and are not stored in plain text', () => {
  const enc = encryptToken('1//refresh-token')
  assert.ok(!enc.includes('refresh-token'))
  assert.notEqual(enc, encryptToken('1//refresh-token'), 'random IV per encryption')
  assert.equal(decryptToken(enc), '1//refresh-token')
})

test('tampered ciphertext is rejected', () => {
  const [v, iv, tag, data] = encryptToken('secret').split(':')
  const flipped = Buffer.from(data, 'base64')
  flipped[0] ^= 1
  assert.throws(() => decryptToken([v, iv, tag, flipped.toString('base64')].join(':')))
})

test('an explicit encryption key must be 32 bytes', () => {
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
  assert.throws(() => encryptToken('x'), /32 bytes/)
})

function mockResponses(...statuses: number[]) {
  let calls = 0
  globalThis.fetch = (async () => {
    const status = statuses[Math.min(calls++, statuses.length - 1)]
    return new Response(JSON.stringify(status === 200 ? { ok: true } : { error: { message: 'boom' } }), { status })
  }) as typeof fetch
  return () => calls
}

test('transient errors are retried with backoff', async () => {
  const calls = mockResponses(503, 429, 200)
  const res = await fetchWithRetry('https://example.test')
  assert.equal(res.status, 200)
  assert.equal(calls(), 3)
})

test('gives up after the retry limit', async () => {
  const calls = mockResponses(500)
  await assert.rejects(fetchWithRetry('https://example.test'), (e: GoogleApiError) => e.retryable && e.status === 500)
  assert.equal(calls(), retryPolicy.attempts)
})

test('permanent errors are not retried', async () => {
  const calls = mockResponses(404)
  await assert.rejects(fetchWithRetry('https://example.test'), (e: GoogleApiError) => !e.retryable)
  assert.equal(calls(), 1)
})
