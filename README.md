# Family Expenses (PWA)

A small installable web app for tracking family spending against a monthly budget that is split into weekly budgets.

- Log in with a username and password. The first visit creates the admin account.
- The admin adds family members, resets passwords and sets budgets.
- You set a monthly budget, and it is split across Mon–Sun weeks by number of days. You can change any week by hand.
- Every member can add expenses and edit or delete their own. Admins can edit or delete anyone's.
- The dashboard shows spending against the month and each week, totals per member, and a filter for one week.

Stack: Next.js 16 (App Router, Server Actions), Neon Postgres (Vercel's database), JWT session cookie, web manifest + service worker.

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. In the project go to **Storage → Create Database → Neon (Postgres)** and connect it to the project. This sets `DATABASE_URL` for you.
3. Under **Settings → Environment Variables**, add `AUTH_SECRET`. Generate one with `openssl rand -base64 32`.
4. Redeploy, then open the site. You will be sent to `/setup` to create the admin account. Tables are created automatically.
5. On your phone, open the site and choose **Add to Home Screen** (Safari) or **Install app** (Chrome).

Optional variables: `APP_TIMEZONE` (default `Asia/Kolkata`) and `NEXT_PUBLIC_CURRENCY` (default `INR`).

## Run locally

```bash
cp .env.example .env.local   # paste your Neon DATABASE_URL and an AUTH_SECRET
npm install
npm run dev
```

## Bank auto-import (SBI / HDFC via Gmail)

Each member can connect their own Gmail (read-only). Bank transaction alert emails are read, turned into
bank transactions, deduplicated and, for debits, added as expenses with the merchant and bank in the note.
Credits are recorded but are not expenses. Bank logins, PINs and OTPs are never asked for or stored.

- **Account → Bank auto-import** (`/bank`): connect/disconnect Gmail, **Sync now**, last sync result, merchant rules.
- **Needs review** (`/review`): transactions with no known category, and alerts that could not be read. Picking a
  category adds the expense and (optionally) saves a merchant rule. Changing the category of an imported expense
  also updates the rule.
- A daily Vercel Cron job (`vercel.json`, 06:00 IST) syncs every connected member. The first sync after connecting
  looks back `GMAIL_BACKFILL_DAYS` (30) days.

> Until the SBI and HDFC parsers have been checked against real (sanitized) alert emails, they are marked
> unverified and **every imported debit waits in the review queue** instead of becoming an expense directly.
> See `tests/fixtures/README.md`.

### SBI via iPhone SMS

SBI doesn't email every transaction, so SBI comes from SMS instead. Each member's iPhone forwards SBI
transaction SMS to `/api/sms/ingest` with a Shortcuts automation, using a personal key from
**Bank auto-import → SBI via iPhone SMS** (step-by-step instructions are on that page). Forwarded SMS go
through the same pipeline: duplicates, merchant rules and the review queue all apply.

- Only SMS from SBI sender IDs are imported. HDFC SMS are ignored because HDFC already arrives by email.
- Messages containing an OTP or verification code are refused and never stored. Other SMS text isn't stored
  either, only the parsed transaction and a hash.
- The key is stored hashed and shown once. Creating a new key or turning forwarding off revokes the old one.
- Until a real SBI SMS has been checked, SBI imports wait in the review queue.

### Google Cloud setup (one time, ~10 minutes)

1. Open <https://console.cloud.google.com/>, create a project (e.g. "Family Expenses").
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform):
   - User type **External**, app name, your support email.
   - **Data access / Scopes**: add `https://www.googleapis.com/auth/gmail.readonly`.
   - **Audience**: add every family member's Gmail as a **test user**.
   - Then **Publish app** (status "In production"). In "Testing" status Google expires the access after
     **7 days** and everyone must reconnect weekly. Unverified apps in production work for up to 100 users;
     members will see a "Google hasn't verified this app" screen → **Advanced → Go to … (unsafe)**. That is
     expected for a private family app.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
   - **Authorized redirect URIs**:
     - `https://<your-vercel-domain>/api/integrations/gmail/callback`
     - `http://localhost:3000/api/integrations/gmail/callback` (for local dev)
5. Copy the client ID and secret into the environment (Vercel **Settings → Environment Variables**, and `.env.local`):

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | from step 4 |
   | `GOOGLE_CLIENT_SECRET` | from step 4 |
   | `GOOGLE_REDIRECT_URI` | optional; the production callback URL above |
   | `GMAIL_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (recommended) |
   | `CRON_SECRET` | any long random string, e.g. `openssl rand -hex 32` |
   | `GMAIL_BACKFILL_DAYS` | optional, default `30` |
   | `GMAIL_SYNC_INTERVAL_MINUTES` | optional, default `5` |

6. Redeploy. Each member opens **Account → Bank auto-import → Connect Gmail**.

Vercel Hobby runs cron jobs once a day, so automatic import is daily; **Sync now** imports immediately.
Changing `GMAIL_TOKEN_ENCRYPTION_KEY` (or `AUTH_SECRET` when that key is unset) requires everyone to reconnect.

### Database changes

Schema changes are versioned in `lib/migrations.ts` and applied automatically on first request
(tracked in `schema_migrations`). Migration 1 adds `gmail_connections`, `gmail_messages`,
`bank_transactions`, `merchant_rules` and `expenses.bank_transaction_id` (unique).

### Tests

```bash
npm test                                                            # unit tests
createdb family_expense_test
TEST_DATABASE_URL=postgres://localhost/family_expense_test npm test # + database tests (wipes that DB)
```
