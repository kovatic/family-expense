'use client'

import { useActionState } from 'react'
import { saveExpenseAction } from '@/app/actions'
import { FormMessage } from './FormMessage'

export type ExpenseValues = {
  id?: number
  amount?: number
  spent_on: string
  category?: string
  note?: string
}

export function ExpenseForm({ initial, categories }: { initial: ExpenseValues; categories: string[] }) {
  const [state, action, pending] = useActionState(saveExpenseAction, undefined)
  // Keep a removed category selectable when editing an old expense.
  const options =
    initial.category && !categories.includes(initial.category) ? [initial.category, ...categories] : categories
  return (
    <form action={action} className="card stack">
      <FormMessage state={state} />
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <label>
        Amount
        <input
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          required
          autoFocus={!initial.id}
          defaultValue={initial.amount}
          placeholder="0"
        />
      </label>
      <label>
        Category
        <select name="category" required defaultValue={initial.category ?? ''}>
          <option value="" disabled>
            Choose…
          </option>
          {options.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input name="spent_on" type="date" required defaultValue={initial.spent_on} />
      </label>
      <label>
        Note <span className="muted small">(optional)</span>
        <input name="note" maxLength={200} defaultValue={initial.note} placeholder="e.g. Vegetables at market" />
      </label>
      <button className="btn block" disabled={pending}>
        {pending ? 'Saving…' : initial.id ? 'Save changes' : 'Add expense'}
      </button>
    </form>
  )
}
