import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  dayLabel,
  monthLabel,
  monthWeeks,
  parseMonth,
  shiftMonth,
  splitBudget,
  today,
  weekRangeLabel,
} from '@/lib/dates'
import { money } from '@/lib/format'
import { Nav } from '@/components/Nav'

type Expense = {
  id: number
  amount: number
  category: string
  note: string
  spent_on: string
  user_id: number | null
  user_name: string
}

function Bar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? (spent / budget) * 100 : spent > 0 ? 100 : 0
  const cls = pct > 100 ? 'bar over' : pct > 85 ? 'bar warn' : 'bar'
  return (
    <div className={cls}>
      <div style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  )
}

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; w?: string }>
}) {
  const me = await requireUser()
  const sp = await searchParams
  const month = parseMonth(sp.m)
  const weeks = monthWeeks(month)
  const first = weeks[0].start
  const last = weeks[weeks.length - 1].end
  const todayStr = today()

  const sql = db()
  const [budgetRows, weekRows, expenseRows] = await Promise.all([
    sql`SELECT amount::float8 AS amount FROM budgets WHERE month = ${month}`,
    sql`SELECT week_index, amount::float8 AS amount FROM week_budgets WHERE month = ${month}`,
    sql`
      SELECT e.id, e.amount::float8 AS amount, e.category, e.note,
             to_char(e.spent_on, 'YYYY-MM-DD') AS spent_on, e.user_id,
             COALESCE(u.name, 'Removed member') AS user_name
      FROM expenses e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.spent_on BETWEEN ${first} AND ${last}
      ORDER BY e.spent_on DESC, e.id DESC`,
  ])
  const expenses = expenseRows as Expense[]

  const monthBudget = budgetRows[0]?.amount ?? 0
  const fallbackSplit = splitBudget(monthBudget, weeks)
  const weekBudget = weeks.map(
    (w) => weekRows.find((r) => r.week_index === w.index)?.amount ?? fallbackSplit[w.index],
  )
  const weekSpent = weeks.map((w) =>
    expenses.filter((e) => e.spent_on >= w.start && e.spent_on <= w.end).reduce((s, e) => s + e.amount, 0),
  )
  const totalSpent = weekSpent.reduce((s, n) => s + n, 0)
  const left = monthBudget - totalSpent

  const selected = sp.w !== undefined && weeks[Number(sp.w)] ? weeks[Number(sp.w)] : null
  const shown = selected
    ? expenses.filter((e) => e.spent_on >= selected.start && e.spent_on <= selected.end)
    : expenses

  const byMember = new Map<string, number>()
  for (const e of shown) byMember.set(e.user_name, (byMember.get(e.user_name) ?? 0) + e.amount)

  const byDay = new Map<string, Expense[]>()
  for (const e of shown) byDay.set(e.spent_on, [...(byDay.get(e.spent_on) ?? []), e])

  return (
    <>
      <main className="page">
        <div className="topbar">
          <div>
            <div className="muted small">Hi, {me.name}</div>
          </div>
          <div className="month-nav">
            <Link href={`/?m=${shiftMonth(month, -1)}`} aria-label="Previous month">‹</Link>
            <span>{monthLabel(month)}</span>
            <Link href={`/?m=${shiftMonth(month, 1)}`} aria-label="Next month">›</Link>
          </div>
        </div>

        <section className="card stack">
          <div className="summary">
            <div>
              <div className="label">Budget</div>
              <div className="value">{money(monthBudget)}</div>
            </div>
            <div>
              <div className="label">Spent</div>
              <div className="value">{money(totalSpent)}</div>
            </div>
            <div>
              <div className="label">{left < 0 ? 'Over by' : 'Left'}</div>
              <div className={`value ${left < 0 ? 'danger-text' : ''}`}>{money(Math.abs(left))}</div>
            </div>
          </div>
          <Bar spent={totalSpent} budget={monthBudget} />
          {monthBudget === 0 && (
            <div className="muted small">
              No budget set for this month.{' '}
              {me.is_admin && (
                <Link href={`/budget?m=${month}`} style={{ color: 'var(--brand)', fontWeight: 600 }}>
                  Set budget →
                </Link>
              )}
            </div>
          )}
        </section>

        <h2>Weeks</h2>
        <div className="weeks">
          {weeks.map((w) => {
            const isCurrent = todayStr >= w.start && todayStr <= w.end
            const isSelected = selected?.index === w.index
            const remaining = weekBudget[w.index] - weekSpent[w.index]
            return (
              <Link
                key={w.index}
                href={isSelected ? `/?m=${month}` : `/?m=${month}&w=${w.index}`}
                className={`card week ${isCurrent ? 'current' : ''} ${isSelected ? 'selected' : ''}`}
              >
                <div className="top">
                  <span>
                    <strong>Week {w.index + 1}</strong>{' '}
                    <span className="muted">· {weekRangeLabel(w)}</span>
                    {isCurrent && <span className="tag">NOW</span>}
                  </span>
                  <span className="num">
                    {money(weekSpent[w.index])} <span className="muted">/ {money(weekBudget[w.index])}</span>
                  </span>
                </div>
                <Bar spent={weekSpent[w.index]} budget={weekBudget[w.index]} />
                <div className={`small ${remaining < 0 ? 'danger-text' : 'muted'}`} style={{ marginTop: 6 }}>
                  {remaining < 0 ? `${money(-remaining)} over` : `${money(remaining)} left`}
                </div>
              </Link>
            )
          })}
        </div>

        <h2>
          {selected ? `Week ${selected.index + 1} expenses` : 'Expenses'}
          {selected && (
            <Link href={`/?m=${month}`} className="small" style={{ marginLeft: 8, color: 'var(--brand)', textTransform: 'none' }}>
              show all
            </Link>
          )}
        </h2>

        {byMember.size > 1 && (
          <div className="chips" style={{ marginBottom: 10 }}>
            {[...byMember].map(([name, amt]) => (
              <span key={name} className="chip">
                {name}: <strong>{money(amt)}</strong>
              </span>
            ))}
          </div>
        )}

        <div className="list">
          {shown.length === 0 && <div className="empty">No expenses yet. Tap + to add one.</div>}
          {[...byDay].map(([day, items]) => (
            <div key={day}>
              <div className="day-head">
                {dayLabel(day)} · {money(items.reduce((s, e) => s + e.amount, 0))}
              </div>
              {items.map((e) => {
                const canEdit = me.is_admin || e.user_id === me.id
                const body = (
                  <>
                    <div>
                      <div>{e.note || e.category}</div>
                      <div className="meta">
                        {e.note ? `${e.category} · ` : ''}
                        {e.user_name}
                      </div>
                    </div>
                    <div className="amt">{money(e.amount)}</div>
                  </>
                )
                return canEdit ? (
                  <Link key={e.id} href={`/expenses/${e.id}`} className="item">
                    {body}
                  </Link>
                ) : (
                  <div key={e.id} className="item">
                    {body}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </main>

      <Link href={`/expenses/new?d=${month === todayStr.slice(0, 7) ? todayStr : first}`} className="fab" aria-label="Add expense">
        +
      </Link>
      <Nav isAdmin={me.is_admin} />
    </>
  )
}
