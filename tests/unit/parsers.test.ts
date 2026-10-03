import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseEmail } from '@/lib/import/parsers'
import { detectType, findDate } from '@/lib/import/parsers/common'
import type { ParsedTransaction } from '@/lib/import/types'
import { fixtureEmail } from '../helpers'

// These use SYNTHETIC fixtures (see tests/fixtures/README.md). They test the parser framework,
// not compatibility with real SBI/HDFC emails.
function parsed(path: string): ParsedTransaction {
  const { parser, result } = parseEmail(fixtureEmail(path))
  assert.ok(parser, `no parser matched ${path}`)
  assert.ok(result.ok, `parse failed for ${path}: ${!result.ok && result.error}`)
  return result.transaction
}

function failure(path: string) {
  const { result } = parseEmail(fixtureEmail(path))
  assert.equal(result.ok, false)
  return result as { ok: false; status: string; error: string }
}

describe('SBI (synthetic)', () => {
  test('UPI debit: amount, date, merchant, reference, account; ignores balance', () => {
    const t = parsed('sbi/synthetic_debit_upi.txt')
    assert.equal(t.bank, 'SBI')
    assert.equal(t.transactionType, 'DEBIT')
    assert.equal(t.amount, 450)
    assert.equal(t.transactionDate, '2026-10-02')
    assert.equal(t.merchantName, 'SWIGGY')
    assert.equal(t.referenceNumber, '612345678901')
    assert.equal(t.accountLast4, '1234')
  })

  test('credit', () => {
    const t = parsed('sbi/synthetic_credit.txt')
    assert.equal(t.transactionType, 'CREDIT')
    assert.equal(t.amount, 2500)
    assert.equal(t.transactionDate, '2026-10-01')
    assert.equal(t.referenceNumber, '612345678904')
    assert.equal(t.utr, '612345678904')
  })

  test('marketing email from the bank is not a transaction', () => {
    assert.equal(failure('sbi/synthetic_unknown_format.txt').status, 'NOT_TRANSACTION')
  })

  test('debit without an amount is PARSE_FAILED, not a guessed expense', () => {
    const f = failure('sbi/synthetic_malformed.txt')
    assert.equal(f.status, 'PARSE_FAILED')
    assert.match(f.error, /Amount/)
  })
})

describe('HDFC (synthetic)', () => {
  test('UPI debit from HTML email', () => {
    const t = parsed('hdfc/synthetic_debit_upi.html')
    assert.equal(t.bank, 'HDFC')
    assert.equal(t.transactionType, 'DEBIT')
    assert.equal(t.amount, 450)
    assert.equal(t.transactionDate, '2026-10-02')
    assert.equal(t.merchantName, 'SWIGGY')
    assert.equal(t.upiId, 'swiggy.order@icici')
    assert.equal(t.referenceNumber, '612345678902')
    assert.equal(t.accountLast4, '1234')
  })

  test('UPI credit', () => {
    const t = parsed('hdfc/synthetic_credit.html')
    assert.equal(t.transactionType, 'CREDIT')
    assert.equal(t.amount, 2500)
    assert.equal(t.merchantName, 'RAVI KUMAR')
    assert.equal(t.upiId, 'friend@okaxis')
  })

  test('"Credit Card" usage is a DEBIT', () => {
    const t = parsed('hdfc/synthetic_card_debit.txt')
    assert.equal(t.transactionType, 'DEBIT')
    assert.equal(t.amount, 1299)
    assert.equal(t.merchantName, 'AMAZON PAY INDIA')
    assert.equal(t.accountLast4, '5678')
    assert.equal(t.transactionTime, '18:42:10')
  })

  test('missing optional fields are allowed', () => {
    const t = parsed('hdfc/synthetic_missing_optional.txt')
    assert.equal(t.amount, 75)
    assert.equal(t.merchantName, null)
    assert.equal(t.referenceNumber, null)
    assert.ok(t.confidence < 1)
  })

  test('newsletter is not a transaction', () => {
    assert.equal(failure('hdfc/synthetic_unknown_format.txt').status, 'NOT_TRANSACTION')
  })
})

// Sanitized REAL email (account, VPA and reference replaced; wording and layout kept).
describe('HDFC (real sample)', () => {
  test('UPI debit', () => {
    const t = parsed('hdfc/debit_upi.html')
    assert.equal(t.bank, 'HDFC')
    assert.equal(t.transactionType, 'DEBIT')
    assert.equal(t.amount, 360)
    assert.equal(t.transactionDate, '2026-10-03')
    assert.equal(t.merchantName, 'TASMAC SHOP NO 8958')
    assert.equal(t.upiId, 'paytm.d00000000000@pty')
    assert.equal(t.referenceNumber, '999999999999')
    assert.equal(t.utr, '999999999999')
    assert.equal(t.accountLast4, '9999')
    assert.equal(t.verifiedFormat, true)
    assert.match(t.description, /^Rs\.360\.00 is debited/)
    assert.ok(!t.description.includes('00000000000'), 'long digit runs masked')
  })

  test('credit with labelled details', () => {
    const t = parsed('hdfc/credit.html')
    assert.equal(t.transactionType, 'CREDIT')
    assert.equal(t.amount, 23834)
    assert.equal(t.transactionDate, '2026-10-01')
    assert.equal(t.merchantName, 'A KUMAR')
    assert.equal(t.upiId, '0000000000@ybl')
    assert.equal(t.referenceNumber, '999999999998')
    assert.equal(t.accountLast4, '9999')
    assert.equal(t.verifiedFormat, true)
    assert.match(t.description, /Rs\.23834\.00 has been successfully credited/)
  })

  test('netbanking notice from the alerts sender is not a transaction', () => {
    assert.equal(failure('hdfc/not_transaction_netbanking.txt').status, 'NOT_TRANSACTION')
  })

  test('only the confirmed wording is verified', () => {
    assert.equal(parsed('hdfc/synthetic_debit_upi.html').verifiedFormat, false)
    assert.equal(parsed('hdfc/synthetic_card_debit.txt').verifiedFormat, false)
    assert.equal(parsed('sbi/synthetic_debit_upi.txt').verifiedFormat, false)
  })
})

describe('common rules', () => {
  test('emails from other senders are not parsed', () => {
    const email = { ...fixtureEmail('hdfc/synthetic_debit_upi.html'), from: 'Phisher <alerts@hdfcbank.net.evil.com>' }
    assert.equal(parseEmail(email).parser, null)
  })

  test('debit/credit comes from wording, first mention wins', () => {
    assert.equal(detectType('Your a/c is debited for Rs 10 and credited to a/c XX99'), 'DEBIT')
    assert.equal(detectType('Rs 10 credited to your account'), 'CREDIT')
    assert.equal(detectType('Your credit card bill is ready'), null)
  })

  test('dates must be near the email date (catches day/month swaps)', () => {
    const received = new Date('2026-10-03T10:00:00+05:30')
    assert.equal(findDate('on 03-10-26', received), '2026-10-03')
    assert.equal(findDate('on 10/03/2026', received), null)
    assert.equal(findDate('dated 2 Oct 2026', received), '2026-10-02')
  })
})
