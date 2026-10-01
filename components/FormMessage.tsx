import type { FormState } from '@/app/actions'

export function FormMessage({ state }: { state: FormState }) {
  if (state?.error) return <div className="alert error">{state.error}</div>
  if (state?.ok) return <div className="alert ok">{state.ok}</div>
  return null
}
