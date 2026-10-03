import { createHash } from 'node:crypto'
import { assignCategory } from './category'
import { normalizeMerchant } from './merchant'
import type { ParsedTransaction } from './types'

export type TransactionStatus = 'IMPORTED' | 'NEEDS_REVIEW' | 'RECORDED' | 'APPROVED' | 'REJECTED'

export type PreparedTransaction = ParsedTransaction & {
  normalizedMerchant: string | null
  category: string | null
  status: TransactionStatus
  reviewReason: string | null
  createExpense: boolean
  fingerprint: string
  note: string
}

// Used only when the bank gives no reference number. Two genuinely separate payments with
// identical details on the same day and no reference would collapse into one; that trade-off
// is preferred over double-counting.
export function transactionFingerprint(userId: number, tx: ParsedTransaction, merchant: string | null) {
  const parts = [
    userId,
    tx.bank,
    tx.accountLast4 ?? '',
    tx.transactionDate,
    tx.amount.toFixed(2),
    tx.transactionType,
    merchant ?? '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex')
}

export function expenseNote(tx: ParsedTransaction, merchant: string | null) {
  const via = tx.upiId || /\bupi\b/i.test(tx.description) ? 'UPI' : null
  const account = tx.accountLast4 ? `${tx.bank} ••${tx.accountLast4}` : tx.bank
  return [merchant ?? 'Bank payment', account, via].filter(Boolean).join(' · ').slice(0, 200)
}

export function prepareTransaction(
  userId: number,
  tx: ParsedTransaction,
  opts: { verified: boolean; userRules: Map<string, string>; categories: string[] },
): PreparedTransaction {
  const merchant = normalizeMerchant(tx.merchantName, tx.upiId)
  const base = {
    ...tx,
    normalizedMerchant: merchant,
    fingerprint: transactionFingerprint(userId, tx, merchant),
    note: expenseNote(tx, merchant),
  }

  // Money coming in is recorded for reference but is not spending.
  if (tx.transactionType === 'CREDIT') {
    return { ...base, category: null, status: 'RECORDED', reviewReason: null, createExpense: false }
  }

  const match = assignCategory(merchant, opts.userRules, opts.categories)
  const reviewReason = !opts.verified
    ? `This ${tx.bank} email format hasn't been checked against a real sample yet`
    : !merchant
      ? 'Merchant not recognised'
      : !match
        ? 'No category rule for this merchant'
        : null
  return {
    ...base,
    category: match?.category ?? null,
    status: reviewReason ? 'NEEDS_REVIEW' : 'IMPORTED',
    reviewReason,
    createExpense: !reviewReason,
  }
}
