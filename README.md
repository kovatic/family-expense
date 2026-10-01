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
