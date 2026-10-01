import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { db } from './db'
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession } from './jwt'

export type User = { id: number; name: string; username: string; is_admin: boolean }

// Re-checks the DB on every request so removed users lose access immediately.
export const getUser = cache(async (): Promise<User | null> => {
  const uid = await verifySession((await cookies()).get(SESSION_COOKIE)?.value)
  if (!uid) return null
  const rows = await db()`SELECT id, name, username, is_admin FROM users WHERE id = ${uid}`
  return (rows[0] as User) ?? null
})

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (!user.is_admin) redirect('/')
  return user
}

export async function startSession(uid: number) {
  ;(await cookies()).set(SESSION_COOKIE, await signSession(uid), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  })
}

export async function endSession() {
  ;(await cookies()).delete(SESSION_COOKIE)
}
