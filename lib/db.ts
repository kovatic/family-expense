import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import { DEFAULT_CATEGORIES } from './format'
import { MIGRATIONS } from './migrations'

type Row = Record<string, any>
export type Query = PromiseLike<Row[]>
export type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Query
  transaction(queries: Query[]): Promise<unknown>
}

let client: Sql | null = null

export function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    client = isLocal(url) ? localPostgres(url) : (neon(url) as unknown as Sql)
  }
  return client
}

function isLocal(url: string) {
  return /@(localhost|127\.0\.0\.1)([:/]|$)/.test(url) || /^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)/.test(url)
}

// Neon's driver only talks HTTP to Neon, so local development against a plain
// Postgres goes through node-postgres with the same tagged-template API.
function localPostgres(url: string): Sql {
  const pool = new Pool({ connectionString: url })
  type LazyQuery = Query & { text: string; values: unknown[] }

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, part, i) => acc + `$${i}` + part)
    let result: Promise<Row[]> | null = null
    const query: LazyQuery = {
      text,
      values,
      // Runs only when awaited, so queries handed to transaction() are not executed twice.
      then: (onOk, onErr) => (result ??= pool.query(text, values).then((r) => r.rows)).then(onOk, onErr),
    }
    return query
  }) as unknown as Sql

  sql.transaction = async (queries) => {
    const conn = await pool.connect()
    try {
      await conn.query('BEGIN')
      for (const q of queries as LazyQuery[]) await conn.query(q.text, q.values)
      await conn.query('COMMIT')
    } catch (err) {
      await conn.query('ROLLBACK')
      throw err
    } finally {
      conn.release()
    }
  }
  return sql
}

let schemaReady: Promise<void> | null = null

// Creates tables on first use, so a fresh Vercel deploy needs no migration step.
export async function getCategories(): Promise<string[]> {
  await ensureSchema()
  const rows = await db()`SELECT name FROM categories ORDER BY lower(name)`
  return rows.map((r) => r.name)
}

export function ensureSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = db()
      await sql`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await sql`CREATE TABLE IF NOT EXISTS budgets (
        month TEXT PRIMARY KEY,
        amount NUMERIC(12,2) NOT NULL
      )`
      await sql`CREATE TABLE IF NOT EXISTS week_budgets (
        month TEXT NOT NULL,
        week_index INT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        PRIMARY KEY (month, week_index)
      )`
      await sql`CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        category TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        spent_on DATE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await sql`CREATE INDEX IF NOT EXISTS expenses_spent_on_idx ON expenses (spent_on)`
      await sql`CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS categories_name_idx ON categories (lower(name))`
      await sql`INSERT INTO categories (name)
        SELECT unnest(${[...DEFAULT_CATEGORIES]}::text[])
        WHERE NOT EXISTS (SELECT 1 FROM categories)`
      await runMigrations(sql)
    })().catch((err) => {
      schemaReady = null
      throw err
    })
  }
  return schemaReady
}

// Versioned schema changes on top of the baseline above. Each runs once, in order,
// inside a transaction holding an advisory lock so concurrent cold starts don't race.
async function runMigrations(sql: Sql) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`
  const done = new Set((await sql`SELECT version FROM schema_migrations`).map((r) => r.version))
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue
    await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(7243001)`,
      ...m.up(sql),
      sql`INSERT INTO schema_migrations (version, name) VALUES (${m.version}, ${m.name})
          ON CONFLICT (version) DO NOTHING`,
    ])
  }
}
