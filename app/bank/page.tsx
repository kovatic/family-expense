import Link from 'next/link'
import { headers } from 'next/headers'
import { deleteMerchantRuleAction, disableSmsAction, disconnectGmailAction } from '@/app/bank-actions'
import { requireUser } from '@/lib/auth'
import { db, ensureSchema, getCategories } from '@/lib/db'
import { isGmailConfigured } from '@/lib/gmail/oauth'
import { TIMEZONE } from '@/lib/dates'
import { MerchantRuleForm, SyncNowForm } from '@/components/BankForms'
import { SmsSetup } from '@/components/SmsSetup'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Nav } from '@/components/Nav'

export const maxDuration = 60

const ERRORS: Record<string, string> = {
  not_configured: 'Gmail import is not set up on the server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET missing).',
  denied: 'Gmail access was not granted.',
  state: 'The Gmail sign-in expired or did not match your session. Please try again.',
  exchange: 'Could not finish connecting to Google. Please try again.',
  scope: 'Please tick the "Read your email" permission so bank alerts can be read.',
  no_refresh: 'Google did not grant offline access. Remove this app at myaccount.google.com/permissions and connect again.',
}

const when = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString('en-IN', { timeZone: TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'Never'

export default async function BankPage({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string }> }) {
  const me = await requireUser()
  const sp = await searchParams
  await ensureSchema()
  const sql = db()
  const h = await headers()
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`
  const [[conn], [counts], rules, categories, [sms]] = await Promise.all([
    sql`SELECT gmail_email, status, last_sync_at, last_sync_status, last_sync_error, last_sync_imported,
               last_sync_skipped, last_sync_review, last_sync_failed, sync_started_at
        FROM gmail_connections WHERE user_id = ${me.id}`,
    sql`SELECT
          (SELECT count(*)::int FROM expenses e JOIN bank_transactions t ON t.id = e.bank_transaction_id
             WHERE t.user_id = ${me.id}) AS imported,
          (SELECT count(*)::int FROM bank_transactions WHERE user_id = ${me.id} AND status = 'NEEDS_REVIEW')
          + (SELECT count(*)::int FROM gmail_messages WHERE user_id = ${me.id} AND processing_status = 'PARSE_FAILED') AS review`,
    sql`SELECT id, merchant, category FROM merchant_rules WHERE user_id = ${me.id} ORDER BY merchant`,
    getCategories(),
    sql`SELECT created_at, last_used_at FROM sms_ingest_tokens WHERE user_id = ${me.id}`,
  ])

  return (
    <>
      <main className="page">
        <h1>Bank auto-import</h1>
        <p className="muted small">
          Reads SBI and HDFC transaction alert emails from your Gmail (read-only) and adds them as expenses. Your bank
          login is never needed or stored.
        </p>

        {sp.error && <div className="alert error">{ERRORS[sp.error] ?? 'Something went wrong.'}</div>}
        {sp.connected && <div className="alert ok">Gmail connected. Importing the last few weeks in the background…</div>}

        <section className="card stack" style={{ marginTop: 12 }}>
          {!conn ? (
            <>
              <div>
                <strong>Gmail</strong> <span className="muted">· Not connected</span>
              </div>
              {isGmailConfigured() ? (
                <a href="/api/integrations/gmail/connect" className="btn block">
                  Connect Gmail
                </a>
              ) : (
                <div className="alert error">{ERRORS.not_configured}</div>
              )}
            </>
          ) : (
            <>
              <div className="row between">
                <div>
                  <strong>Gmail</strong>{' '}
                  <span className={conn.status === 'ACTIVE' ? 'muted' : 'danger-text'}>
                    · {conn.status === 'ACTIVE' ? 'Connected' : 'Reconnect needed'}
                  </span>
                  <div className="muted small">{conn.gmail_email}</div>
                </div>
              </div>
              {conn.status !== 'ACTIVE' && (
                <a href="/api/integrations/gmail/connect" className="btn block">
                  Reconnect Gmail
                </a>
              )}

              <div className="summary">
                <div>
                  <div className="label">Imported</div>
                  <div className="value">{counts.imported}</div>
                </div>
                <div>
                  <div className="label">Needs review</div>
                  <div className="value">
                    {counts.review > 0 ? <Link href="/review" style={{ color: 'var(--brand)' }}>{counts.review}</Link> : 0}
                  </div>
                </div>
                <div>
                  <div className="label">Last sync</div>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {conn.sync_started_at ? 'Running…' : (conn.last_sync_status ?? '—')}
                  </div>
                </div>
              </div>

              <div className="muted small">
                Last sync: {when(conn.last_sync_at)}
                {conn.last_sync_at && (
                  <>
                    {' '}
                    · {conn.last_sync_imported} imported · {conn.last_sync_review} to review · {conn.last_sync_skipped}{' '}
                    already imported{conn.last_sync_failed > 0 && ` · ${conn.last_sync_failed} failed`}
                  </>
                )}
              </div>
              {conn.last_sync_error && <div className="alert error">{conn.last_sync_error}</div>}

              {conn.status === 'ACTIVE' && <SyncNowForm />}
              <div className="muted small">New alerts are also picked up automatically once a day.</div>

              <form action={disconnectGmailAction}>
                <ConfirmButton
                  message="Disconnect Gmail? Already imported expenses stay. Future alerts won't be imported."
                  className="btn ghost block"
                >
                  Disconnect Gmail
                </ConfirmButton>
              </form>
            </>
          )}
        </section>

        <h2>SBI via iPhone SMS</h2>
        <section className="card stack">
          <div className="muted small">
            SBI doesn&apos;t email every transaction, so your iPhone forwards SBI transaction SMS here with a Shortcuts
            automation. OTP messages are refused and SMS text is never stored.
          </div>
          {sms && (
            <div className="small">
              <strong>Active</strong> · last SMS received: {when(sms.last_used_at)}
            </div>
          )}
          <SmsSetup endpoint={`${origin}/api/sms/ingest`} hasToken={Boolean(sms)} />
          <details className="small">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How to set up the Shortcut</summary>
            <ol style={{ paddingLeft: 18, lineHeight: 1.6 }}>
              <li>Tap <strong>Set up SMS forwarding</strong> above and keep the URL and key handy.</li>
              <li>
                iPhone <strong>Shortcuts</strong> app → <strong>Automation</strong> → <strong>+</strong> →{' '}
                <strong>Message</strong>.
              </li>
              <li>
                <strong>Message Contains</strong>: <code>debited</code>. <strong>Sender</strong>: choose the SBI sender
                (e.g. the one that sent your last debit SMS). Select <strong>Run Immediately</strong>, then{' '}
                <strong>Next</strong>.
              </li>
              <li>
                Add action <strong>Get Contents of URL</strong>. URL: the URL above. Tap <strong>›</strong>: Method{' '}
                <strong>POST</strong>; Headers: <code>Authorization</code> = the key value above; Request Body{' '}
                <strong>JSON</strong> with fields <code>message</code> = <em>Shortcut Input → Content</em> and{' '}
                <code>sender</code> = <em>Shortcut Input → Sender</em>.
              </li>
              <li>
                Repeat steps 2–4 with <code>credited</code> if you also want money received recorded.
              </li>
            </ol>
          </details>
          {sms && (
            <form action={disableSmsAction}>
              <ConfirmButton message="Turn off SMS forwarding? The Shortcut will stop working." className="btn ghost block">
                Turn off SMS forwarding
              </ConfirmButton>
            </form>
          )}
        </section>

        <h2>Merchant rules</h2>
        <p className="muted small">
          Imports from these merchants get this category automatically. Rules are also saved when you pick a category
          in the review queue or change one on an imported expense.
        </p>
        <MerchantRuleForm categories={categories} />
        {rules.length > 0 && (
          <div className="list" style={{ marginTop: 12 }}>
            {rules.map((r) => (
              <div key={r.id} className="item" style={{ alignItems: 'center' }}>
                <div>
                  <div>{r.merchant}</div>
                  <div className="meta">{r.category}</div>
                </div>
                <form action={deleteMerchantRuleAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="btn danger small">Remove</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </main>
      <Nav isAdmin={me.is_admin} />
    </>
  )
}
