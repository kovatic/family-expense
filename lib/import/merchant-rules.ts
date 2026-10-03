import { db, type Query } from '@/lib/db'

export function upsertMerchantRule(userId: number, merchant: string, category: string): Query {
  return db()`
    INSERT INTO merchant_rules (user_id, merchant, category) VALUES (${userId}, ${merchant}, ${category})
    ON CONFLICT (user_id, merchant) DO UPDATE SET category = EXCLUDED.category, updated_at = now()`
}

// When someone re-categorises an imported expense, remember it for that merchant.
export async function learnFromExpense(expenseId: number, category: string) {
  const sql = db()
  const [tx] = await sql`
    SELECT t.id, t.user_id, t.merchant_name FROM expenses e
    JOIN bank_transactions t ON t.id = e.bank_transaction_id
    WHERE e.id = ${expenseId}`
  if (!tx) return
  const queries = [sql`UPDATE bank_transactions SET category = ${category}, updated_at = now() WHERE id = ${tx.id}`]
  if (tx.merchant_name) queries.push(upsertMerchantRule(tx.user_id, tx.merchant_name, category))
  await sql.transaction(queries)
}
