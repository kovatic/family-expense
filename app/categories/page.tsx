import { deleteCategoryAction } from '@/app/actions'
import { requireAdmin } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { AddCategoryForm } from '@/components/AddCategoryForm'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Nav } from '@/components/Nav'

export default async function CategoriesPage() {
  await requireAdmin()
  await ensureSchema()
  const categories = await db()`
    SELECT c.id, c.name, count(e.id)::int AS uses
    FROM categories c LEFT JOIN expenses e ON e.category = c.name
    GROUP BY c.id ORDER BY lower(c.name)`

  return (
    <>
      <main className="page">
        <h1>Categories</h1>
        <AddCategoryForm />

        <h2>{categories.length} categories</h2>
        <div className="list">
          {categories.length === 0 && <div className="empty">No categories yet. Add one above.</div>}
          {categories.map((c) => (
            <div key={c.id} className="item" style={{ alignItems: 'center' }}>
              <div>
                <div>{c.name}</div>
                <div className="meta">
                  {c.uses} expense{c.uses === 1 ? '' : 's'}
                </div>
              </div>
              <form action={deleteCategoryAction}>
                <input type="hidden" name="id" value={c.id} />
                <ConfirmButton
                  message={`Remove "${c.name}"? Past expenses keep this category; it just won't be offered for new ones.`}
                  className="btn danger small"
                >
                  Remove
                </ConfirmButton>
              </form>
            </div>
          ))}
        </div>
      </main>
      <Nav isAdmin />
    </>
  )
}
