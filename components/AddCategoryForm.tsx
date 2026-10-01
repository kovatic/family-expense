'use client'

import { useActionState } from 'react'
import { addCategoryAction } from '@/app/actions'
import { FormMessage } from './FormMessage'

export function AddCategoryForm() {
  const [state, action, pending] = useActionState(addCategoryAction, undefined)
  return (
    <form action={action} className="card stack">
      <FormMessage state={state} />
      <div className="row">
        <input name="name" required maxLength={40} placeholder="e.g. Kids, Fuel, Gifts" />
        <button className="btn" disabled={pending}>
          Add
        </button>
      </div>
    </form>
  )
}
