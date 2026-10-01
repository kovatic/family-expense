import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { loginAction } from '@/app/actions'
import { getUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { CredentialsForm } from '@/components/CredentialsForm'

export default async function LoginPage() {
  await connection()
  await ensureSchema()
  const [{ count }] = await db()`SELECT count(*)::int AS count FROM users`
  if (count === 0) redirect('/setup')
  if (await getUser()) redirect('/')

  return (
    <main className="page center">
      <h1>Family Expenses</h1>
      <CredentialsForm action={loginAction} submitLabel="Log in" />
    </main>
  )
}
