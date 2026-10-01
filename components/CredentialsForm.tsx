'use client'

import { useActionState } from 'react'
import type { FormState } from '@/app/actions'
import { FormMessage } from './FormMessage'

// Shared by the login page and the first-run setup page.
export function CredentialsForm({
  action,
  withName,
  submitLabel,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>
  withName?: boolean
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)
  return (
    <form action={formAction} className="card stack">
      <FormMessage state={state} />
      {withName && (
        <label>
          Your name
          <input name="name" required autoComplete="name" />
        </label>
      )}
      <label>
        Username
        <input name="username" required autoCapitalize="none" autoCorrect="off" autoComplete="username" />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete={withName ? 'new-password' : 'current-password'}
        />
      </label>
      <button className="btn block" disabled={pending}>
        {pending ? 'Please wait…' : submitLabel}
      </button>
    </form>
  )
}
