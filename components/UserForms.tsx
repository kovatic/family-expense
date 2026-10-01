'use client'

import { useActionState, useState } from 'react'
import { changePasswordAction, createUserAction, resetPasswordAction } from '@/app/actions'
import { FormMessage } from './FormMessage'

export function AddUserForm() {
  const [state, action, pending] = useActionState(createUserAction, undefined)
  return (
    <form action={action} className="card stack">
      <FormMessage state={state} />
      <label>
        Name
        <input name="name" required />
      </label>
      <label>
        Username
        <input name="username" required autoCapitalize="none" autoCorrect="off" />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={6} autoComplete="new-password" />
      </label>
      <label className="check">
        <input type="checkbox" name="is_admin" /> Admin (can manage members & budgets)
      </label>
      <button className="btn block" disabled={pending}>
        {pending ? 'Adding…' : 'Add member'}
      </button>
    </form>
  )
}

export function ResetPasswordForm({ id }: { id: number }) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(resetPasswordAction, undefined)
  if (!open) {
    return (
      <button type="button" className="btn ghost small" onClick={() => setOpen(true)}>
        Reset password
      </button>
    )
  }
  return (
    <form action={action} className="stack" style={{ width: '100%' }}>
      <FormMessage state={state} />
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <input name="password" type="password" placeholder="New password" required minLength={6} autoComplete="new-password" />
        <button className="btn small" disabled={pending}>Set</button>
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>✕</button>
      </div>
    </form>
  )
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, undefined)
  return (
    <form action={action} className="card stack">
      <FormMessage state={state} />
      <label>
        Current password
        <input name="current" type="password" required autoComplete="current-password" />
      </label>
      <label>
        New password
        <input name="password" type="password" required minLength={6} autoComplete="new-password" />
      </label>
      <button className="btn block" disabled={pending}>
        {pending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  )
}
