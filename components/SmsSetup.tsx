'use client'

import { useActionState } from 'react'
import { createSmsTokenAction } from '@/app/bank-actions'

export function SmsSetup({ endpoint, hasToken }: { endpoint: string; hasToken: boolean }) {
  const [state, action, pending] = useActionState(createSmsTokenAction, undefined)
  return (
    <div className="stack">
      {state?.token ? (
        <div className="stack">
          <div className="alert ok">Copy these into the Shortcut now. The key won&apos;t be shown again.</div>
          <label>
            URL
            <input readOnly value={endpoint} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <label>
            Authorization header value
            <input readOnly value={`Bearer ${state.token}`} onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      ) : (
        <form action={action}>
          <button className={hasToken ? 'btn ghost block' : 'btn block'} disabled={pending}>
            {hasToken ? 'Create new key (old one stops working)' : 'Set up SMS forwarding'}
          </button>
        </form>
      )}
    </div>
  )
}
