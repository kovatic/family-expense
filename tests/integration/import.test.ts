import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, test } from 'node:test'
import type { EmailMessage } from '@/lib/import/types'
import { fixture, gmailMessage } from '../helpers'

// Runs against a throwaway Postgres database: TEST_DATABASE_URL=postgres://localhost/family_expense_test
// Every table is truncated between tests, so never point this at real data.
const url = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = url
process.env.AUTH_SECRET = 'test-secret'
process.env.GOOGLE_CLIENT_ID = 'test-client'
process.env.GOOGLE_CLIENT_SECRET = 'test-secret'

describe('import pipeline (database)', { skip: !url && 'set TEST_DATABASE_URL to run' }, () => {
  let db: typeof import('@/lib/db').db
  let pipeline: typeof import('@/lib/import/pipeline')
  let sync: typeof import('@/lib/import/sync')
  let PatternParser: typeof import('@/lib/import/parsers/common').PatternParser
  let encryptToken: typeof import('@/lib/gmail/crypto').encryptToken
  let toEmail: typeof import('@/lib/gmail/body').toEmailMessage
  let userId: number
  const realFetch = globalThis.fetch

  before(async () => {
    const dbm = await import('@/lib/db')
    db = dbm.db
    await dbm.ensureSchema()
    pipeline = await import('@/lib/import/pipeline')
    sync = await import('@/lib/import/sync')
    PatternParser = (await import('@/lib/import/parsers/common')).PatternParser
    encryptToken = (await import('@/lib/gmail/crypto')).encryptToken
    toEmail = (await import('@/lib/gmail/body')).toEmailMessage
    ;(await import('@/lib/gmail/http')).retryPolicy.baseDelayMs = 1
  })

  beforeEach(async () => {
    await db()`TRUNCATE gmail_connections, gmail_messages, sms_ingest_tokens, bank_transactions, merchant_rules, expenses, users RESTART IDENTITY CASCADE`
    ;[{ id: userId }] = await db()`
      INSERT INTO users (name, username, password_hash) VALUES ('Test', 'test', 'x') RETURNING id`
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  after(() => {
    globalThis.fetch = realFetch
  })

  // A verified HDFC parser, as it will be once real samples have been checked.
  const verified = () => [new PatternParser('HDFC', true, {})]

  function hdfcEmail(id: string, body: string, date = 'Fri, 02 Oct 2026 13:20:00 +0530'): EmailMessage {
    const msg = gmailMessage(id, `From: HDFC Test <alerts@example.hdfcbank.net>\nSubject: Alert\nDate: ${date}\n\n${body}`)
    return { id, threadId: null, from: 'HDFC Test <alerts@example.hdfcbank.net>', subject: 'Alert', receivedAt: new Date(Number(msg.internalDate)), text: body }
  }

  const counts = async () => {
    const [row] = await db()`
      SELECT (SELECT count(*)::int FROM bank_transactions) AS tx, (SELECT count(*)::int FROM expenses) AS exp,
             (SELECT count(*)::int FROM gmail_messages) AS msg`
    return row
  }

  test('same Gmail message processed three times -> one transaction, one expense', async () => {
    const ctx = await pipeline.loadContext(userId)
    const email = hdfcEmail('m1', 'Rs.450.00 has been debited from account **1234 to VPA swiggy@icici SWIGGY on 02-10-26. Your UPI transaction reference number is 612345678902.')
    const outcomes = []
    for (let i = 0; i < 3; i++) outcomes.push((await pipeline.processEmail(ctx, email, verified())).status)
    assert.deepEqual(outcomes, ['IMPORTED', 'DUPLICATE', 'DUPLICATE'])
    assert.deepEqual(await counts(), { tx: 1, exp: 1, msg: 1 })
    const [e] = await db()`SELECT category, note, amount::float8 AS amount FROM expenses`
    assert.deepEqual(e, { category: 'Food & Dining', note: 'SWIGGY · HDFC ••1234 · UPI', amount: 450 })
  })

  test('different email with the same bank reference is a duplicate', async () => {
    const ctx = await pipeline.loadContext(userId)
    const body = 'Rs.450.00 has been debited from account **1234 to VPA swiggy@icici SWIGGY on 02-10-26. Your UPI transaction reference number is 612345678902.'
    await pipeline.processEmail(ctx, hdfcEmail('m1', body), verified())
    const second = await pipeline.processEmail(ctx, hdfcEmail('m2', body), verified())
    assert.equal(second.status, 'DUPLICATE')
    assert.deepEqual(await counts(), { tx: 1, exp: 1, msg: 2 })
  })

  test('without a reference, the fingerprint deduplicates; different merchant or date does not', async () => {
    const ctx = await pipeline.loadContext(userId)
    const run = (id: string, body: string) => pipeline.processEmail(ctx, hdfcEmail(id, body), verified())
    assert.equal((await run('a', 'Rs.200.00 debited from a/c **1234 at ZOMATO on 02-10-26.')).status, 'IMPORTED')
    assert.equal((await run('b', 'Rs.200.00 debited from a/c **1234 at ZOMATO on 02-10-26.')).status, 'DUPLICATE')
    assert.equal((await run('c', 'Rs.200.00 debited from a/c **1234 at SWIGGY on 02-10-26.')).status, 'IMPORTED')
    assert.equal((await run('d', 'Rs.200.00 debited from a/c **1234 at ZOMATO on 01-10-26.')).status, 'IMPORTED')
    assert.deepEqual(await counts(), { tx: 3, exp: 3, msg: 4 })
  })

  test('user merchant rule beats default; unknown merchant waits for review', async () => {
    await db()`INSERT INTO merchant_rules (user_id, merchant, category) VALUES (${userId}, 'DECATHLON', 'Shopping')`
    const ctx = await pipeline.loadContext(userId)
    await pipeline.processEmail(ctx, hdfcEmail('a', 'Rs.999.00 debited from a/c **1234 at DECATHLON on 02-10-26. Ref No 111111'), verified())
    const unknown = await pipeline.processEmail(ctx, hdfcEmail('b', 'Rs.120.00 debited from a/c **1234 at RAMU TEA STALL on 02-10-26. Ref No 222222'), verified())
    assert.equal(unknown.status, 'NEEDS_REVIEW')
    const rows = await db()`SELECT merchant_name, status, category FROM bank_transactions ORDER BY id`
    assert.deepEqual(rows, [
      { merchant_name: 'DECATHLON', status: 'IMPORTED', category: 'Shopping' },
      { merchant_name: 'RAMU TEA STALL', status: 'NEEDS_REVIEW', category: null },
    ])
    assert.equal((await counts()).exp, 1)
  })

  test('unverified parsers never create expenses on their own', async () => {
    const ctx = await pipeline.loadContext(userId)
    const out = await pipeline.processEmail(ctx, hdfcEmail('m1', 'Rs.450.00 debited from a/c **1234 at SWIGGY on 02-10-26.'))
    assert.equal(out.status, 'NEEDS_REVIEW')
    assert.equal((await counts()).exp, 0)
  })

  test('hand-entered expense with same day and amount goes to review instead of double counting', async () => {
    await db()`INSERT INTO expenses (user_id, amount, category, spent_on) VALUES (${userId}, 450, 'Food & Dining', '2026-10-02')`
    const ctx = await pipeline.loadContext(userId)
    const out = await pipeline.processEmail(ctx, hdfcEmail('m1', 'Rs.450.00 debited from a/c **1234 at SWIGGY on 02-10-26.'), verified())
    assert.equal(out.status, 'NEEDS_REVIEW')
    assert.equal((await counts()).exp, 1)
  })

  test('parse failure is recorded, creates nothing', async () => {
    const ctx = await pipeline.loadContext(userId)
    const out = await pipeline.processEmail(ctx, hdfcEmail('m1', 'Your a/c **1234 has been debited. See statement.'), verified())
    assert.equal(out.status, 'PARSE_FAILED')
    const [m] = await db()`SELECT processing_status, processing_error FROM gmail_messages`
    assert.equal(m.processing_status, 'PARSE_FAILED')
    assert.match(m.processing_error, /Amount/)
    assert.equal((await counts()).tx, 0)
  })

  test('real HDFC UPI debit: unknown merchant -> review; after choosing a category, the next one imports', async () => {
    const real = (id: string, date: string) => {
      const raw = fixture('hdfc/debit_upi.html').replace('03-10-26', date).replace('999999999999', id.padStart(12, '0'))
      const msg = gmailMessage(id, raw)
      return { ...hdfcEmail(id, ''), ...toEmail(msg) }
    }
    let ctx = await pipeline.loadContext(userId)
    assert.equal((await pipeline.processEmail(ctx, real('1', '03-10-26'))).status, 'NEEDS_REVIEW')
    await db()`INSERT INTO merchant_rules (user_id, merchant, category) VALUES (${userId}, 'TASMAC', 'Other')`
    ctx = await pipeline.loadContext(userId)
    assert.equal((await pipeline.processEmail(ctx, real('2', '02-10-26'))).status, 'IMPORTED')
    const [e] = await db()`SELECT category, note, amount::float8 AS amount FROM expenses`
    assert.deepEqual(e, { category: 'Other', note: 'TASMAC · HDFC ••9999 · UPI', amount: 360 })
  })

  describe('SMS forwarding', () => {
    // SYNTHETIC SBI SMS wording; replace with a sanitized real one when available.
    const debitSms = 'Dear UPI user A/C X1234 debited by 450.00 on date 02Oct26 trf to SWIGGY Refno 612345678901. -SBI'

    test('token auth, idempotent ingest, OTP refused, unknown sender ignored', async () => {
      const sms = await import('@/lib/import/sms')
      const token = await sms.createSmsToken(userId)
      assert.equal(await sms.userForSmsToken(token), userId)
      assert.equal(await sms.userForSmsToken('sms_wrong'), null)
      assert.equal(await sms.userForSmsToken(null), null)

      const at = new Date('2026-10-02T12:00:00+05:30')
      const first = await sms.ingestSms(userId, 'AD-SBIUPI', debitSms, at)
      assert.equal(first.status, 'NEEDS_REVIEW', 'SBI SMS format not verified yet')
      assert.equal((await sms.ingestSms(userId, 'AD-SBIUPI', debitSms, at)).status, 'DUPLICATE')

      assert.equal((await sms.ingestSms(userId, 'AD-SBIUPI', 'OTP for login is 123456. Do not share.', at)).status, 'REJECTED')
      assert.equal((await sms.ingestSms(userId, 'AD-HDFCBK', 'Rs 10 debited from a/c **1234', at)).status, 'IGNORED')

      const [tx] = await db()`SELECT source, bank, amount::float8 AS amount, reference_number FROM bank_transactions`
      assert.deepEqual(tx, { source: 'SMS', bank: 'SBI', amount: 450, reference_number: '612345678901' })
      const stored = await db()`SELECT subject, source FROM gmail_messages ORDER BY id`
      assert.equal(stored.length, 2, 'the OTP message is not stored at all')
      assert.ok(stored.every((m) => m.source === 'SMS'))

      // A new key replaces the old one.
      const second = await sms.createSmsToken(userId)
      assert.equal(await sms.userForSmsToken(token), null)
      assert.equal(await sms.userForSmsToken(second), userId)
    })
  })

  describe('sync (manual and scheduled share this path)', () => {
    const messages: Record<string, string> = {
      g1: fixture('hdfc/synthetic_debit_upi.html'),
      g2: fixture('hdfc/synthetic_credit.html'),
      g3: fixture('sbi/synthetic_malformed.txt'),
      g4: fixture('hdfc/synthetic_unknown_format.txt'),
    }
    let calls: string[]
    let failOnce: Set<string>

    async function connect() {
      await db()`
        INSERT INTO gmail_connections (user_id, gmail_email, access_token_encrypted, refresh_token_encrypted, token_expiry)
        VALUES (${userId}, 'me@example.com', ${encryptToken('expired-access')}, ${encryptToken('refresh')}, now() - interval '1 hour')`
    }

    // Fake Google: token refresh, message list (+ one message that 404s), message get.
    function fakeGoogle() {
      calls = []
      globalThis.fetch = (async (input: string | URL | Request) => {
        const u = new URL(String(input))
        calls.push(u.pathname)
        const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
        if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'fresh', expires_in: 3600 })
        if (u.pathname.endsWith('/messages')) {
          return json({ messages: [...Object.keys(messages), 'gone'].map((id) => ({ id })) })
        }
        const id = decodeURIComponent(u.pathname.split('/').pop()!)
        if (failOnce.delete(id)) return json({ error: { message: 'backend error' } }, 503)
        if (!messages[id]) return json({ error: { message: 'not found' } }, 404)
        return json(gmailMessage(id, messages[id]))
      }) as typeof fetch
    }

    beforeEach(() => {
      failOnce = new Set(['g1'])
    })

    test('imports, isolates a bad message, retries transient errors, and is idempotent', async () => {
      await connect()
      fakeGoogle()
      const first = await sync.syncUser(userId)
      assert.equal(first.status, 'PARTIAL', 'the 404 message counts as failed')
      assert.equal(first.found, 5)
      assert.equal(first.review, 1, 'HDFC debit (unverified parser) -> review')
      assert.equal(first.recorded, 1, 'credit recorded, no expense')
      assert.equal(first.ignored, 1)
      assert.equal(first.failed, 2, 'malformed SBI email + missing message')
      assert.ok(calls.filter((p) => p.endsWith('/g1')).length === 2, 'g1 was retried after a 503')

      const [conn] = await db()`SELECT status, last_sync_status, sync_started_at, access_token_encrypted FROM gmail_connections`
      assert.equal(conn.last_sync_status, 'PARTIAL')
      assert.equal(conn.sync_started_at, null)
      assert.ok(!conn.access_token_encrypted.includes('fresh'))

      fakeGoogle()
      const again = await sync.syncUser(userId)
      assert.equal(again.duplicates, 4, 'already handled messages are skipped without fetching')
      assert.equal(again.failed, 1, 'only the transient ERROR message is retried')
      assert.ok(!calls.some((p) => /\/g[1-4]$/.test(p)))
      assert.deepEqual(await counts(), { tx: 2, exp: 0, msg: 5 })
    })

    test('scheduled sync runs due connections and skips recently synced ones', async () => {
      await connect()
      fakeGoogle()
      const results = await sync.syncAllDue()
      assert.deepEqual(results.map((r) => r.userId), [userId])
      assert.deepEqual(await sync.syncAllDue(), [], 'synced within the interval')
    })

    test('revoked Google access marks the connection for reconnect', async () => {
      await connect()
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 })) as typeof fetch
      const s = await sync.syncUser(userId)
      assert.equal(s.status, 'REAUTH_REQUIRED')
      const [conn] = await db()`SELECT status FROM gmail_connections`
      assert.equal(conn.status, 'REAUTH_REQUIRED')
    })

    test('a second concurrent sync is refused', async () => {
      await connect()
      await db()`UPDATE gmail_connections SET sync_started_at = now()`
      assert.equal((await sync.syncUser(userId)).status, 'BUSY')
    })
  })
})
