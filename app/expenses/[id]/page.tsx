import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { deleteExpenseAction } from '@/app/actions'
import { requireUser } from '@/lib/auth'
import { db, getCategories } from '@/lib/db'
import { ExpenseForm, type ExpenseValues } from '@/components/ExpenseForm'
import { ConfirmButton } from '@/components/ConfirmButton'

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser()
  const id = Number((await params).id)
  if (!Number.isInteger(id)) notFound()

  const [e] = await db()`
    SELECT id, amount::float8 AS amount, category, note, user_id,
           to_char(spent_on, 'YYYY-MM-DD') AS spent_on
    FROM expenses WHERE id = ${id}`
  if (!e) notFound()
  if (e.user_id !== me.id && !me.is_admin) redirect('/')
  const month = e.spent_on.slice(0, 7)

  return (
    <main className="page">
      <div className="topbar">
        <h1>Edit expense</h1>
        <Link href={`/?m=${month}`} className="btn ghost small">Cancel</Link>
      </div>
      <div className="stack">
        <ExpenseForm initial={e as ExpenseValues} categories={await getCategories()} />
        <form action={deleteExpenseAction}>
          <input type="hidden" name="id" value={e.id} />
          <input type="hidden" name="month" value={month} />
          <ConfirmButton message="Delete this expense?" className="btn danger block">
            Delete expense
          </ConfirmButton>
        </form>
      </div>
    </main>
  )
}
