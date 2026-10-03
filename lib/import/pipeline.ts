import { createHash } from 'node:crypto'
import { db, getCategories } from '@/lib/db'
import { parseEmail } from './parsers'
import { prepareTransaction, type PreparedTransaction } from './prepare'
import type { BankTransactionParser, EmailMessage } from './types'

export type MessageStatus =
  | 'PROCESSED' // a new bank transaction was saved
  | 'DUPLICATE' // the transaction already existed (same reference or fingerprint)
  | 'IGNORED' // from a bank but not a transaction alert
  | 'PARSE_FAILED' // looked like a transaction but critical fields were missing
  | 'ERROR' // unexpected/transient failure; retried on later syncs
  | 'DISMISSED' // a PARSE_FAILED message the user cleared from the review queue

export type Outcome =
  | { status: 'IMPORTED' | 'NEEDS_REVIEW' | 'RECORDED'; bank: string }
  | { status: 'DUPLICATE' | 'IGNORED' | 'PARSE_FAILED'; bank: string | null }

export const MAX_ATTEMPTS = 5

export type PipelineContext = { userId: number; userRules: Map<string, string>; categories: string[] }

export async function loadContext(userId: number): Promise<PipelineContext> {
  const [rules, categories] = await Promise.all([
    db()`SELECT merchant, category FROM merchant_rules WHERE user_id = ${userId}`,
    getCategories(),
  ])
  return { userId, userRules: new Map(rules.map((r) => [r.merchant, r.category])), categories }
}

const hashText = (text: string) => createHash('sha256').update(text).digest('hex')

// Records a message that produced no transaction. Its status is final except ERROR.
export async function recordMessage(
  userId: number,
  email: Pick<EmailMessage, 'id' | 'threadId' | 'from' | 'subject' | 'receivedAt' | 'source'> & { text?: string },
  status: MessageStatus,
  bank: string | null,
  error: string | null,
) {
  await db()`
    INSERT INTO gmail_messages (user_id, gmail_message_id, gmail_thread_id, sender, subject, received_at,
                                message_hash, bank_detected, processing_status, processing_error, attempts, source)
    VALUES (${userId}, ${email.id}, ${email.threadId}, ${email.from}, ${email.subject.slice(0, 300)},
            ${email.receivedAt.toISOString()}, ${email.text ? hashText(email.text) : null}, ${bank},
            ${status}, ${error?.slice(0, 500) ?? null}, 1, ${email.source ?? 'GMAIL'})
    ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
      processing_status = EXCLUDED.processing_status,
      processing_error = EXCLUDED.processing_error,
      bank_detected = COALESCE(EXCLUDED.bank_detected, gmail_messages.bank_detected),
      message_hash = COALESCE(EXCLUDED.message_hash, gmail_messages.message_hash),
      attempts = gmail_messages.attempts + 1,
      updated_at = now()`
}

// The single path from a fetched email to bank transaction + expense, shared by manual,
// scheduled and first-connect syncs. Safe to call repeatedly for the same email.
export async function processEmail(ctx: PipelineContext, email: EmailMessage, parsers?: BankTransactionParser[]): Promise<Outcome> {
  const { parser, result } = parseEmail(email, parsers)
  const bank = parser?.bank ?? null
  if (!result.ok) {
    const status = result.status === 'NOT_TRANSACTION' ? 'IGNORED' : 'PARSE_FAILED'
    await recordMessage(ctx.userId, email, status, bank, result.error)
    return { status, bank }
  }

  let prepared = prepareTransaction(ctx.userId, result.transaction, {
    verified: result.transaction.verifiedFormat,
    userRules: ctx.userRules,
    categories: ctx.categories,
  })
  prepared = await flagManualDuplicate(ctx.userId, prepared)
  const saved = await saveTransaction(ctx.userId, prepared, email)
  if (!saved) return { status: 'DUPLICATE', bank: prepared.bank }
  return { status: prepared.status as 'IMPORTED' | 'NEEDS_REVIEW' | 'RECORDED', bank: prepared.bank }
}

// A hand-entered expense with the same day and amount is probably this payment, so ask
// the user instead of counting it twice.
async function flagManualDuplicate(userId: number, tx: PreparedTransaction): Promise<PreparedTransaction> {
  if (!tx.createExpense) return tx
  const [match] = await db()`
    SELECT 1 FROM expenses
    WHERE user_id = ${userId} AND spent_on = ${tx.transactionDate} AND amount = ${tx.amount}
      AND bank_transaction_id IS NULL
    LIMIT 1`
  if (!match) return tx
  return { ...tx, status: 'NEEDS_REVIEW', createExpense: false, reviewReason: 'You already added an expense with this amount on this day' }
}

// One statement, so the transaction, its expense and the message record commit together.
// Unique indexes (message id, reference number, fingerprint) make a repeat a no-op.
async function saveTransaction(userId: number, tx: PreparedTransaction, email: EmailMessage) {
  const datetime = tx.transactionTime ? `${tx.transactionDate}T${tx.transactionTime}+05:30` : null
  const payload = {
    parser_confidence: tx.confidence,
    category_source: tx.category ? 'rule' : null,
    received_at: email.receivedAt.toISOString(),
  }
  const [row] = await db()`
    WITH tx AS (
      INSERT INTO bank_transactions (
        user_id, bank, account_last4, transaction_date, transaction_datetime, transaction_type, amount,
        currency, merchant_name, original_description, description, reference_number, utr, upi_id, source,
        source_message_id, category, confidence_score, status, review_reason, transaction_fingerprint, raw_payload)
      VALUES (
        ${userId}, ${tx.bank}, ${tx.accountLast4}, ${tx.transactionDate}, ${datetime}, ${tx.transactionType},
        ${tx.amount}, ${tx.currency}, ${tx.normalizedMerchant}, ${tx.merchantName}, ${tx.description},
        ${tx.referenceNumber}, ${tx.utr}, ${tx.upiId}, ${email.source ?? 'GMAIL'}, ${email.id}, ${tx.category}, ${tx.confidence},
        ${tx.status}, ${tx.reviewReason}, ${tx.fingerprint}, ${JSON.stringify(payload)})
      ON CONFLICT DO NOTHING
      RETURNING id
    ), exp AS (
      INSERT INTO expenses (user_id, amount, category, note, spent_on, bank_transaction_id)
      SELECT ${userId}::int, ${tx.amount}::numeric, ${tx.category}::text, ${tx.note}::text, ${tx.transactionDate}::date, id
      FROM tx WHERE ${tx.createExpense}::boolean
      RETURNING id
    ), msg AS (
      INSERT INTO gmail_messages (user_id, gmail_message_id, gmail_thread_id, sender, subject, received_at,
                                  message_hash, bank_detected, processing_status, attempts, source)
      VALUES (${userId}, ${email.id}, ${email.threadId}, ${email.from}, ${email.subject.slice(0, 300)},
              ${email.receivedAt.toISOString()}, ${hashText(email.text)}, ${tx.bank},
              CASE WHEN EXISTS (SELECT 1 FROM tx) THEN 'PROCESSED' ELSE 'DUPLICATE' END, 1, ${email.source ?? 'GMAIL'})
      ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
        processing_status = CASE WHEN gmail_messages.processing_status = 'PROCESSED' THEN 'PROCESSED'
                                 ELSE EXCLUDED.processing_status END,
        processing_error = NULL,
        bank_detected = EXCLUDED.bank_detected,
        message_hash = EXCLUDED.message_hash,
        attempts = gmail_messages.attempts + 1,
        updated_at = now()
      RETURNING id
    )
    SELECT (SELECT id FROM tx) AS transaction_id, (SELECT id FROM exp) AS expense_id, (SELECT id FROM msg) AS message_id`
  return row.transaction_id ? { transactionId: row.transaction_id as number, expenseId: row.expense_id as number | null } : null
}
