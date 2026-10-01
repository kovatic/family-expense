import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { getCategories } from '@/lib/db'
import { DATE_RE, today } from '@/lib/dates'
import { ExpenseForm } from '@/components/ExpenseForm'

export default async function NewExpensePage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireUser()
  const { d } = await searchParams
  const date = d && DATE_RE.test(d) ? d : today()

  return (
    <main className="page">
      <div className="topbar">
        <h1>New expense</h1>
        <Link href={`/?m=${date.slice(0, 7)}`} className="btn ghost small">Cancel</Link>
      </div>
      <ExpenseForm initial={{ spent_on: date }} categories={await getCategories()} />
    </main>
  )
}
