'use server'

import { revalidatePath } from 'next/cache'
import type { FormState } from '@/app/actions'
import { requireUser } from '@/lib/auth'
import { db, getCategories } from '@/lib/db'
import { decryptToken } from '@/lib/gmail/crypto'
import { revokeToken } from '@/lib/gmail/oauth'
import { normalizeMerchant } from '@/lib/import/merchant'
import { upsertMerchantRule } from '@/lib/import/merchant-rules'
import { createSmsToken } from '@/lib/import/sms'
import { syncUser } from '@/lib/import/sync'

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim()

function refresh() {
  revalidatePath('/')
  revalidatePath('/bank')
  revalidatePath('/review')
}

/* ---------- gmail connection ---------- */

export async function syncNowAction(_: FormState): Promise<FormState> {
  const me = await requireUser()
  const s = await syncUser(me.id)
  refresh()
  if (s.status === 'BUSY') return { error: 'A sync is already running. Try again in a minute.' }
  if (s.status === 'FAILED' || s.status === 'REAUTH_REQUIRED') return { error: s.error ?? 'Sync failed' }
  const parts = [
    `${s.imported} imported`,
    s.review && `${s.review} need review`,
    s.recorded && `${s.recorded} credits recorded`,
    s.duplicates && `${s.duplicates} already imported`,
    s.failed && `${s.failed} failed`,
  ].filter(Boolean)
  return { ok: `Sync done: ${parts.join(' · ')}` }
}

// Removes the stored tokens and revokes Google access. Imported expenses stay.
export async function disconnectGmailAction() {
  const me = await requireUser()
  const [conn] = await db()`
    DELETE FROM gmail_connections WHERE user_id = ${me.id} RETURNING refresh_token_encrypted`
  if (conn) {
    try {
      await revokeToken(decryptToken(conn.refresh_token_encrypted))
    } catch {
      // The connection is gone either way; the user can also revoke at myaccount.google.com.
    }
  }
  refresh()
}

/* ---------- review queue ---------- */

export async function approveTransactionAction(fd: FormData) {
  const me = await requireUser()
  const id = Number(fd.get('id'))
  const category = str(fd, 'category')
  const remember = fd.get('remember') === 'on'
  if (!(await getCategories()).includes(category)) return

  const sql = db()
  const [tx] = await sql`
    SELECT merchant_name, bank, account_last4, upi_id FROM bank_transactions
    WHERE id = ${id} AND user_id = ${me.id} AND status = 'NEEDS_REVIEW' AND transaction_type = 'DEBIT'`
  if (!tx) return
  const account = tx.account_last4 ? `${tx.bank} ••${tx.account_last4}` : tx.bank
  const note = [tx.merchant_name ?? 'Bank payment', account, tx.upi_id ? 'UPI' : null].filter(Boolean).join(' · ')

  const queries = [
    sql`
      WITH t AS (
        UPDATE bank_transactions SET status = 'APPROVED', category = ${category}, review_reason = NULL, updated_at = now()
        WHERE id = ${id} AND user_id = ${me.id} AND status = 'NEEDS_REVIEW'
        RETURNING id, amount, transaction_date
      )
      INSERT INTO expenses (user_id, amount, category, note, spent_on, bank_transaction_id)
      SELECT ${me.id}::int, amount, ${category}::text, ${note}::text, transaction_date, id FROM t
      ON CONFLICT DO NOTHING`,
  ]
  if (remember && tx.merchant_name) queries.push(upsertMerchantRule(me.id, tx.merchant_name, category))
  await sql.transaction(queries)
  refresh()
}

export async function rejectTransactionAction(fd: FormData) {
  const me = await requireUser()
  await db()`
    UPDATE bank_transactions SET status = 'REJECTED', updated_at = now()
    WHERE id = ${Number(fd.get('id'))} AND user_id = ${me.id} AND status = 'NEEDS_REVIEW'`
  refresh()
}

export async function dismissMessageAction(fd: FormData) {
  const me = await requireUser()
  await db()`
    UPDATE gmail_messages SET processing_status = 'DISMISSED', updated_at = now()
    WHERE id = ${Number(fd.get('id'))} AND user_id = ${me.id} AND processing_status IN ('PARSE_FAILED', 'ERROR')`
  refresh()
}

/* ---------- merchant rules ---------- */

export async function addMerchantRuleAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser()
  const merchant = normalizeMerchant(str(fd, 'merchant').slice(0, 80))
  const category = str(fd, 'category')
  if (!merchant) return { error: 'Enter a merchant name' }
  if (!(await getCategories()).includes(category)) return { error: 'Pick a category' }
  await upsertMerchantRule(me.id, merchant, category)
  refresh()
  return { ok: `${merchant} → ${category}` }
}

export async function deleteMerchantRuleAction(fd: FormData) {
  const me = await requireUser()
  await db()`DELETE FROM merchant_rules WHERE id = ${Number(fd.get('id'))} AND user_id = ${me.id}`
  refresh()
}

/* ---------- SMS forwarding (iPhone Shortcuts) ---------- */

export type SmsTokenState = { token?: string; error?: string } | undefined

// The token is shown once; only its hash is kept.
export async function createSmsTokenAction(_: SmsTokenState): Promise<SmsTokenState> {
  const me = await requireUser()
  const token = await createSmsToken(me.id)
  revalidatePath('/bank')
  return { token }
}

export async function disableSmsAction() {
  const me = await requireUser()
  await db()`DELETE FROM sms_ingest_tokens WHERE user_id = ${me.id}`
  revalidatePath('/bank')
}
