import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assignCategory } from '@/lib/import/category'
import { normalizeMerchant } from '@/lib/import/merchant'
import { prepareTransaction, transactionFingerprint } from '@/lib/import/prepare'
import type { ParsedTransaction } from '@/lib/import/types'
import { DEFAULT_CATEGORIES } from '@/lib/format'

const categories = [...DEFAULT_CATEGORIES]

test('merchant variants normalize to one name', () => {
  for (const raw of ['UPI/SWIGGY', 'SWIGGY*ONLINE', 'SWIGGY IN', 'Swiggy Limited']) {
    assert.equal(normalizeMerchant(raw), 'SWIGGY')
  }
  assert.equal(normalizeMerchant(null, 'zomato-order@hdfcbank'), 'ZOMATO')
  assert.equal(normalizeMerchant('Avenue Supermarts Ltd'), 'DMART')
  assert.equal(normalizeMerchant('TASMAC SHOP NO 8958'), 'TASMAC')
})

test('unknown merchants are tidied, not guessed', () => {
  assert.equal(normalizeMerchant('upi/ Sri Lakshmi  Stores '), 'SRI LAKSHMI STORES')
  assert.equal(normalizeMerchant('COCA COLA DEPOT'), 'COCA COLA DEPOT')
  assert.equal(normalizeMerchant(null), null)
})

test('category priority: user rule, then default rule, then none', () => {
  const user = new Map([['SWIGGY', 'Groceries'], ['DECATHLON', 'Shopping']])
  assert.deepEqual(assignCategory('SWIGGY', user, categories), { category: 'Groceries', source: 'USER_RULE' })
  assert.deepEqual(assignCategory('ZOMATO', user, categories), { category: 'Food & Dining', source: 'DEFAULT_RULE' })
  assert.deepEqual(assignCategory('DECATHLON', user, categories), { category: 'Shopping', source: 'USER_RULE' })
  assert.equal(assignCategory('SOME SHOP', user, categories), null)
  // A rule pointing at a category that was removed is ignored.
  assert.equal(assignCategory('ZOMATO', new Map(), ['Shopping']), null)
})

const tx = (over: Partial<ParsedTransaction> = {}): ParsedTransaction => ({
  bank: 'HDFC',
  transactionType: 'DEBIT',
  amount: 450,
  currency: 'INR',
  transactionDate: '2026-10-02',
  transactionTime: null,
  merchantName: 'SWIGGY',
  description: 'UPI payment',
  referenceNumber: null,
  utr: null,
  upiId: 'swiggy@icici',
  accountLast4: '1234',
  sourceMessageId: 'm1',
  confidence: 1,
  verifiedFormat: false,
  ...over,
})

test('fingerprint is stable and separates different transactions', () => {
  const a = transactionFingerprint(1, tx(), 'SWIGGY')
  assert.equal(a, transactionFingerprint(1, tx({ sourceMessageId: 'other' }), 'SWIGGY'))
  assert.notEqual(a, transactionFingerprint(1, tx(), 'ZOMATO'))
  assert.notEqual(a, transactionFingerprint(1, tx({ transactionDate: '2026-10-03' }), 'SWIGGY'))
  assert.notEqual(a, transactionFingerprint(2, tx(), 'SWIGGY'))
  assert.notEqual(a, transactionFingerprint(1, tx({ transactionType: 'CREDIT' }), 'SWIGGY'))
})

test('verified parser + known merchant imports; otherwise review', () => {
  const opts = { userRules: new Map<string, string>(), categories }
  const ok = prepareTransaction(1, tx(), { ...opts, verified: true })
  assert.equal(ok.status, 'IMPORTED')
  assert.equal(ok.createExpense, true)
  assert.equal(ok.category, 'Food & Dining')
  assert.equal(ok.note, 'SWIGGY · HDFC ••1234 · UPI')

  const unverified = prepareTransaction(1, tx(), { ...opts, verified: false })
  assert.equal(unverified.status, 'NEEDS_REVIEW')
  assert.equal(unverified.category, 'Food & Dining', 'suggestion kept for the review screen')
  assert.equal(unverified.createExpense, false)

  const unknown = prepareTransaction(1, tx({ merchantName: 'NEW SHOP', upiId: null }), { ...opts, verified: true })
  assert.equal(unknown.status, 'NEEDS_REVIEW')
  assert.equal(unknown.category, null)
})

test('credits are recorded, never expenses', () => {
  const p = prepareTransaction(1, tx({ transactionType: 'CREDIT' }), { verified: true, userRules: new Map(), categories })
  assert.equal(p.status, 'RECORDED')
  assert.equal(p.createExpense, false)
})
