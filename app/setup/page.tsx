import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { setupAction } from '@/app/actions'
import { db, ensureSchema } from '@/lib/db'
import { CredentialsForm } from '@/components/CredentialsForm'

export default async function SetupPage() {
  await connection()
  await ensureSchema()
  const [{ count }] = await db()`SELECT count(*)::int AS count FROM users`
  if (count > 0) redirect('/login')

  return (
    <main className="page center">
      <h1>Welcome 👋</h1>
      <p className="muted">Create the first account. It will be the admin who adds family members and sets budgets.</p>
      <CredentialsForm action={setupAction} withName submitLabel="Create admin account" />
    </main>
  )
}
