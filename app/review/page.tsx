import Link from 'next/link'
import { approveTransactionAction, dismissMessageAction, rejectTransactionAction } from '@/app/bank-actions'
import { requireUser } from '@/lib/auth'
import { db, ensureSchema, getCategories } from '@/lib/db'
import { dayLabel, TIMEZONE } from '@/lib/dates'
import { money } from '@/lib/format'
import { Nav } from '@/components/Nav'

export default async function ReviewPage() {
  const me = await requireUser()
  await ensureSchema()
  const sql = db()
  const [transactions, failed, categories] = await Promise.all([
    sql`SELECT id, bank, account_last4, amount::float8 AS amount, merchant_name, description, category, review_reason,
               to_char(transaction_date, 'YYYY-MM-DD') AS date
        FROM bank_transactions WHERE user_id = ${me.id} AND status = 'NEEDS_REVIEW'
        ORDER BY transaction_date DESC, id DESC`,
    sql`SELECT id, bank_detected, subject, processing_error, received_at
        FROM gmail_messages WHERE user_id = ${me.id} AND processing_status = 'PARSE_FAILED'
        ORDER BY received_at DESC`,
    getCategories(),
  ])

  return (
    <>
      <main className="page">
        <h1>Needs review</h1>
        {transactions.length === 0 && failed.length === 0 && (
          <div className="list">
            <div className="empty">
              Nothing to review. <Link href="/bank" style={{ color: 'var(--brand)' }}>Bank settings →</Link>
            </div>
          </div>
        )}

        <div className="stack">
          {transactions.map((t) => (
            <section key={t.id} className="card stack">
              <div className="row between">
                <div>
                  <strong>{t.merchant_name ?? 'Unknown merchant'}</strong>
                  <div className="muted small">
                    {t.bank}
                    {t.account_last4 && ` ••${t.account_last4}`} · {dayLabel(t.date)}
                  </div>
                </div>
                <div className="num" style={{ fontWeight: 700 }}>{money(t.amount)}</div>
              </div>
              {t.review_reason && <div className="muted small">{t.review_reason}</div>}
              <form action={approveTransactionAction} className="stack">
                <input type="hidden" name="id" value={t.id} />
                <select name="category" required defaultValue={t.category ?? ''}>
                  <option value="" disabled>
                    Pick a category
                  </option>
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                {t.merchant_name && (
                  <label className="check">
                    <input type="checkbox" name="remember" defaultChecked />
                    Always use this for {t.merchant_name}
                  </label>
                )}
                <button className="btn block">Add expense</button>
              </form>
              <form action={rejectTransactionAction}>
                <input type="hidden" name="id" value={t.id} />
                <button className="btn ghost block">Not an expense / already added</button>
              </form>
            </section>
          ))}
        </div>

        {failed.length > 0 && (
          <>
            <h2>Couldn&apos;t read</h2>
            <p className="muted small">
              These look like bank alerts but the amount or debit/credit could not be read. Add them by hand if needed.
            </p>
            <div className="list">
              {failed.map((m) => (
                <div key={m.id} className="item" style={{ alignItems: 'center' }}>
                  <div>
                    <div>{m.subject || 'Bank email'}</div>
                    <div className="meta">
                      {m.bank_detected ?? 'Bank'} ·{' '}
                      {new Date(m.received_at).toLocaleDateString('en-IN', { timeZone: TIMEZONE, day: 'numeric', month: 'short' })}{' '}
                      · {m.processing_error}
                    </div>
                  </div>
                  <form action={dismissMessageAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="btn ghost small">Dismiss</button>
                  </form>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
      <Nav isAdmin={me.is_admin} />
    </>
  )
}
