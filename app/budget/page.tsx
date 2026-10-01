import Link from 'next/link'
import { requireAdmin } from '@/lib/auth'
import { db } from '@/lib/db'
import { monthLabel, monthWeeks, parseMonth, shiftMonth, splitBudget } from '@/lib/dates'
import { BudgetForm } from '@/components/BudgetForm'
import { Nav } from '@/components/Nav'

export default async function BudgetPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireAdmin()
  const month = parseMonth((await searchParams).m)
  const weeks = monthWeeks(month)

  const sql = db()
  const [[budget], weekRows] = await Promise.all([
    sql`SELECT amount::float8 AS amount FROM budgets WHERE month = ${month}`,
    sql`SELECT week_index, amount::float8 AS amount FROM week_budgets WHERE month = ${month}`,
  ])
  const amount = budget?.amount ?? 0
  const fallback = splitBudget(amount, weeks)
  const weekAmounts = weeks.map(
    (w) => weekRows.find((r) => r.week_index === w.index)?.amount ?? fallback[w.index],
  )

  return (
    <>
      <main className="page">
        <div className="topbar">
          <h1>Budget</h1>
          <div className="month-nav">
            <Link href={`/budget?m=${shiftMonth(month, -1)}`} aria-label="Previous month">‹</Link>
            <span>{monthLabel(month)}</span>
            <Link href={`/budget?m=${shiftMonth(month, 1)}`} aria-label="Next month">›</Link>
          </div>
        </div>
        {/* key resets the form state when switching months */}
        <BudgetForm key={month} month={month} weeks={weeks} initialAmount={amount} initialWeeks={weekAmounts} />
      </main>
      <Nav isAdmin />
    </>
  )
}
