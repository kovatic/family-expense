'use client'

import { useActionState } from 'react'
import { addMerchantRuleAction, syncNowAction } from '@/app/bank-actions'
import { FormMessage } from './FormMessage'

export function SyncNowForm() {
  const [state, action, pending] = useActionState(syncNowAction, undefined)
  return (
    <form action={action} className="stack">
      <FormMessage state={state} />
      <button className="btn block" disabled={pending}>
        {pending ? 'Syncing…' : 'Sync now'}
      </button>
    </form>
  )
}

export function MerchantRuleForm({ categories }: { categories: string[] }) {
  const [state, action, pending] = useActionState(addMerchantRuleAction, undefined)
  return (
    <form action={action} className="card stack">
      <FormMessage state={state} />
      <input name="merchant" required maxLength={80} placeholder="Merchant, e.g. DECATHLON" />
      <div className="row">
        <select name="category" required defaultValue="">
          <option value="" disabled>
            Category
          </option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button className="btn" disabled={pending}>
          Save
        </button>
      </div>
    </form>
  )
}
