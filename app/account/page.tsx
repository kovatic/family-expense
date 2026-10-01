import { logoutAction } from '@/app/actions'
import { requireUser } from '@/lib/auth'
import { ChangePasswordForm } from '@/components/UserForms'
import { Nav } from '@/components/Nav'

export default async function AccountPage() {
  const me = await requireUser()
  return (
    <>
      <main className="page">
        <h1>Account</h1>
        <div className="card">
          <div>
            <strong>{me.name}</strong> {me.is_admin && <span className="tag">ADMIN</span>}
          </div>
          <div className="muted small">@{me.username}</div>
        </div>

        <h2>Change password</h2>
        <ChangePasswordForm />

        <form action={logoutAction} style={{ marginTop: 24 }}>
          <button className="btn ghost block">Log out</button>
        </form>
      </main>
      <Nav isAdmin={me.is_admin} />
    </>
  )
}
