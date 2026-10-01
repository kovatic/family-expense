'use client'

import { useActionState, useState } from 'react'
import { saveBudgetAction } from '@/app/actions'
import { splitBudget, weekRangeLabel, type Week } from '@/lib/dates'
import { money } from '@/lib/format'
import { FormMessage } from './FormMessage'

export function BudgetForm({
  month,
  weeks,
  initialAmount,
  initialWeeks,
}: {
  month: string
  weeks: Week[]
  initialAmount: number
  initialWeeks: number[]
}) {
  const [state, action, pending] = useActionState(saveBudgetAction, undefined)
  const [amount, setAmount] = useState(String(initialAmount || ''))
  const [weekAmounts, setWeekAmounts] = useState(initialWeeks.map((n) => String(n || '')))

  const total = Number(amount) || 0
  const allocated = weekAmounts.reduce((s, v) => s + (Number(v) || 0), 0)
  const diff = Math.round((total - allocated) * 100) / 100

  const autoSplit = (value = total) => setWeekAmounts(splitBudget(value, weeks).map(String))

  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <input type="hidden" name="month" value={month} />

      <div className="card stack">
        <label>
          Monthly budget
          <input
            name="amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            required
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              autoSplit(Number(e.target.value) || 0)
            }}
          />
        </label>
        <p className="muted small" style={{ margin: 0 }}>
          Weeks are split automatically by number of days. Adjust any week below.
        </p>
      </div>

      <div className="card stack">
        <div className="row between">
          <strong>Weekly split</strong>
          <button type="button" className="btn ghost small" onClick={() => autoSplit()}>
            Auto split
          </button>
        </div>
        {weeks.map((w) => (
          <div key={w.index} className="week-grid">
            <div>
              <div>Week {w.index + 1}</div>
              <div className="muted small">
                Days {weekRangeLabel(w)} · {w.days} day{w.days > 1 ? 's' : ''}
              </div>
            </div>
            <input
              name={`week_${w.index}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="1"
              required
              value={weekAmounts[w.index]}
              onChange={(e) =>
                setWeekAmounts((prev) => prev.map((v, i) => (i === w.index ? e.target.value : v)))
              }
            />
          </div>
        ))}
        <div className={`small ${diff === 0 ? 'muted' : 'danger-text'}`}>
          Allocated {money(allocated)} of {money(total)}
          {diff > 0 && ` · ${money(diff)} unallocated`}
          {diff < 0 && ` · ${money(-diff)} over monthly budget`}
        </div>
      </div>

      <button className="btn block" disabled={pending}>
        {pending ? 'Saving…' : 'Save budget'}
      </button>
    </form>
  )
}
