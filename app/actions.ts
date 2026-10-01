'use server'

import bcrypt from 'bcryptjs'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, ensureSchema } from '@/lib/db'
import { endSession, requireAdmin, requireUser, startSession } from '@/lib/auth'
import { DATE_RE, MONTH_RE, monthWeeks } from '@/lib/dates'

export type FormState = { error?: string; ok?: string } | undefined

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/
const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim()

function validPassword(pw: string) {
  return pw.length >= 6 ? null : 'Password must be at least 6 characters'
}

function isUniqueViolation(err: unknown) {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505'
}

/* ---------- auth ---------- */

export async function setupAction(_: FormState, fd: FormData): Promise<FormState> {
  await ensureSchema()
  const sql = db()
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM users`
  if (count > 0) return { error: 'Setup is already complete. Please log in.' }

  const name = str(fd, 'name')
  const username = str(fd, 'username').toLowerCase()
  const password = String(fd.get('password') ?? '')
  if (!name) return { error: 'Name is required' }
  if (!USERNAME_RE.test(username)) return { error: 'Username: 3–32 letters, numbers, . _ -' }
  const pwError = validPassword(password)
  if (pwError) return { error: pwError }

  const hash = await bcrypt.hash(password, 10)
  const [user] = await sql`
    INSERT INTO users (name, username, password_hash, is_admin)
    VALUES (${name}, ${username}, ${hash}, TRUE) RETURNING id`
  await startSession(user.id)
  redirect('/')
}

export async function loginAction(_: FormState, fd: FormData): Promise<FormState> {
  await ensureSchema()
  const username = str(fd, 'username').toLowerCase()
  const password = String(fd.get('password') ?? '')
  const [user] = await db()`SELECT id, password_hash FROM users WHERE username = ${username}`
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return { error: 'Wrong username or password' }
  }
  await startSession(user.id)
  redirect('/')
}

export async function logoutAction() {
  await endSession()
  redirect('/login')
}

export async function changePasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser()
  const current = String(fd.get('current') ?? '')
  const next = String(fd.get('password') ?? '')
  const pwError = validPassword(next)
  if (pwError) return { error: pwError }

  const sql = db()
  const [row] = await sql`SELECT password_hash FROM users WHERE id = ${me.id}`
  if (!(await bcrypt.compare(current, row.password_hash))) {
    return { error: 'Current password is wrong' }
  }
  await sql`UPDATE users SET password_hash = ${await bcrypt.hash(next, 10)} WHERE id = ${me.id}`
  return { ok: 'Password changed' }
}

/* ---------- users (admin) ---------- */

export async function createUserAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin()
  const name = str(fd, 'name')
  const username = str(fd, 'username').toLowerCase()
  const password = String(fd.get('password') ?? '')
  const isAdmin = fd.get('is_admin') === 'on'
  if (!name) return { error: 'Name is required' }
  if (!USERNAME_RE.test(username)) return { error: 'Username: 3–32 letters, numbers, . _ -' }
  const pwError = validPassword(password)
  if (pwError) return { error: pwError }

  try {
    await db()`
      INSERT INTO users (name, username, password_hash, is_admin)
      VALUES (${name}, ${username}, ${await bcrypt.hash(password, 10)}, ${isAdmin})`
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `Username "${username}" is taken` }
    throw err
  }
  revalidatePath('/users')
  return { ok: `Added ${name}` }
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin()
  const id = Number(fd.get('id'))
  const password = String(fd.get('password') ?? '')
  const pwError = validPassword(password)
  if (pwError) return { error: pwError }
  await db()`UPDATE users SET password_hash = ${await bcrypt.hash(password, 10)} WHERE id = ${id}`
  return { ok: 'Password reset' }
}

export async function deleteUserAction(fd: FormData) {
  const me = await requireAdmin()
  const id = Number(fd.get('id'))
  if (id === me.id) return
  await db()`DELETE FROM users WHERE id = ${id}`
  revalidatePath('/users')
}

/* ---------- categories (admin) ---------- */

export async function addCategoryAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin()
  const name = str(fd, 'name').replace(/\s+/g, ' ').slice(0, 40)
  if (!name) return { error: 'Enter a category name' }
  try {
    await db()`INSERT INTO categories (name) VALUES (${name})`
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `"${name}" already exists` }
    throw err
  }
  revalidatePath('/categories')
  return { ok: `Added ${name}` }
}

export async function deleteCategoryAction(fd: FormData) {
  await requireAdmin()
  await db()`DELETE FROM categories WHERE id = ${Number(fd.get('id'))}`
  revalidatePath('/categories')
}

/* ---------- budget (admin) ---------- */

export async function saveBudgetAction(_: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin()
  const month = str(fd, 'month')
  if (!MONTH_RE.test(month)) return { error: 'Invalid month' }
  const amount = Number(fd.get('amount'))
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Enter a valid monthly budget' }

  const weeks = monthWeeks(month)
  const weekAmounts = weeks.map((w) => Number(fd.get(`week_${w.index}`)))
  if (weekAmounts.some((a) => !Number.isFinite(a) || a < 0)) {
    return { error: 'Enter a valid amount for every week' }
  }

  const sql = db()
  await sql.transaction([
    sql`INSERT INTO budgets (month, amount) VALUES (${month}, ${amount})
        ON CONFLICT (month) DO UPDATE SET amount = EXCLUDED.amount`,
    sql`DELETE FROM week_budgets WHERE month = ${month}`,
    ...weeks.map(
      (w) =>
        sql`INSERT INTO week_budgets (month, week_index, amount)
            VALUES (${month}, ${w.index}, ${weekAmounts[w.index]})`,
    ),
  ])
  revalidatePath('/')
  revalidatePath('/budget')
  return { ok: 'Budget saved' }
}

/* ---------- expenses ---------- */

async function loadOwnExpense(id: number) {
  const me = await requireUser()
  const [row] = await db()`SELECT user_id FROM expenses WHERE id = ${id}`
  if (!row) return { me, error: 'Expense not found' }
  if (row.user_id !== me.id && !me.is_admin) return { me, error: 'You can only change your own expenses' }
  return { me }
}

export async function saveExpenseAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser()
  const id = Number(fd.get('id')) || null
  const amount = Number(fd.get('amount'))
  const spentOn = str(fd, 'spent_on')
  const category = str(fd, 'category')
  const note = str(fd, 'note').slice(0, 200)

  if (!Number.isFinite(amount) || amount <= 0) return { error: 'Enter an amount above 0' }
  if (!DATE_RE.test(spentOn)) return { error: 'Pick a valid date' }
  if (!category) return { error: 'Pick a category' }

  const sql = db()
  const [known] = await sql`SELECT 1 FROM categories WHERE name = ${category}`
  if (id) {
    const { error } = await loadOwnExpense(id)
    if (error) return { error }
    // An edited expense may keep a category that has since been removed.
    const [same] = await sql`SELECT 1 FROM expenses WHERE id = ${id} AND category = ${category}`
    if (!known && !same) return { error: 'Pick a category' }
    await sql`
      UPDATE expenses SET amount = ${amount}, spent_on = ${spentOn}, category = ${category}, note = ${note}
      WHERE id = ${id}`
  } else {
    if (!known) return { error: 'Pick a category' }
    await sql`
      INSERT INTO expenses (user_id, amount, spent_on, category, note)
      VALUES (${me.id}, ${amount}, ${spentOn}, ${category}, ${note})`
  }
  revalidatePath('/')
  redirect(`/?m=${spentOn.slice(0, 7)}`)
}

export async function deleteExpenseAction(fd: FormData) {
  const id = Number(fd.get('id'))
  const month = str(fd, 'month')
  const { error } = await loadOwnExpense(id)
  if (!error) await db()`DELETE FROM expenses WHERE id = ${id}`
  revalidatePath('/')
  redirect(MONTH_RE.test(month) ? `/?m=${month}` : '/')
}
