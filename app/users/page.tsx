import { deleteUserAction } from '@/app/actions'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { AddUserForm, ResetPasswordForm } from '@/components/UserForms'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Nav } from '@/components/Nav'

export default async function UsersPage() {
  const me = await requireAdmin()
  const users = await db()`SELECT id, name, username, is_admin FROM users ORDER BY name`

  return (
    <>
      <main className="page">
        <h1>Members</h1>
        <div className="list">
          {users.map((u) => (
            <div key={u.id} className="item" style={{ flexDirection: 'column' }}>
              <div className="row between">
                <div>
                  <div>
                    {u.name} {u.is_admin && <span className="tag">ADMIN</span>}
                  </div>
                  <div className="meta">@{u.username}</div>
                </div>
                {u.id !== me.id && (
                  <form action={deleteUserAction}>
                    <input type="hidden" name="id" value={u.id} />
                    <ConfirmButton
                      message={`Remove ${u.name}? Their past expenses stay, marked as "Removed member".`}
                      className="btn danger small"
                    >
                      Remove
                    </ConfirmButton>
                  </form>
                )}
              </div>
              {u.id !== me.id && <ResetPasswordForm id={u.id} />}
            </div>
          ))}
        </div>

        <h2>Add member</h2>
        <AddUserForm />
      </main>
      <Nav isAdmin />
    </>
  )
}
