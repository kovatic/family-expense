import { db, ensureSchema } from '@/lib/db'
import { toEmailMessage } from '@/lib/gmail/body'
import { getMessage, listMessageIds } from '@/lib/gmail/client'
import { decryptToken, encryptToken } from '@/lib/gmail/crypto'
import { GoogleApiError } from '@/lib/gmail/http'
import { refreshAccessToken } from '@/lib/gmail/oauth'
import { MAX_ATTEMPTS, loadContext, processEmail, recordMessage, type Outcome } from './pipeline'
import { gmailQuery } from './rules'

export const BACKFILL_DAYS = Number(process.env.GMAIL_BACKFILL_DAYS) || 30
export const SYNC_INTERVAL_MINUTES = Number(process.env.GMAIL_SYNC_INTERVAL_MINUTES) || 5
const MAX_MESSAGES_PER_SYNC = 300
const OVERLAP_DAYS = 3
const CONCURRENCY = 5

export type SyncSummary = {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'BUSY' | 'REAUTH_REQUIRED'
  found: number
  imported: number
  recorded: number
  review: number
  duplicates: number
  ignored: number
  failed: number
  error?: string
}

type Connection = {
  id: number
  user_id: number
  access_token_encrypted: string | null
  refresh_token_encrypted: string
  token_expiry: Date | string | null
  last_success_at: Date | string | null
}

const empty = (status: SyncSummary['status'], error?: string): SyncSummary => ({
  status, found: 0, imported: 0, recorded: 0, review: 0, duplicates: 0, ignored: 0, failed: 0, error,
})

const log = (userId: number, msg: string) => console.info(`[gmail-sync] user=${userId} ${msg}`)

async function accessToken(conn: Connection) {
  const expiry = conn.token_expiry ? new Date(conn.token_expiry).getTime() : 0
  if (conn.access_token_encrypted && expiry - Date.now() > 60_000) return decryptToken(conn.access_token_encrypted)
  const tokens = await refreshAccessToken(decryptToken(conn.refresh_token_encrypted))
  await db()`
    UPDATE gmail_connections SET access_token_encrypted = ${encryptToken(tokens.accessToken)},
      token_expiry = ${tokens.expiresAt.toISOString()}, updated_at = now()
    WHERE id = ${conn.id}`
  return tokens.accessToken
}

// Claims the connection for this run; a crashed run's claim expires after 10 minutes.
async function claim(userId: number) {
  const [conn] = await db()`
    UPDATE gmail_connections SET sync_started_at = now()
    WHERE user_id = ${userId} AND status = 'ACTIVE'
      AND (sync_started_at IS NULL OR sync_started_at < now() - interval '10 minutes')
    RETURNING id, user_id, access_token_encrypted, refresh_token_encrypted, token_expiry, last_success_at`
  return (conn as Connection | undefined) ?? null
}

// Manual "Sync Now", the daily cron and the first sync after connecting all come through here.
export async function syncUser(userId: number): Promise<SyncSummary> {
  await ensureSchema()
  const conn = await claim(userId)
  if (!conn) return empty('BUSY', 'A sync is already running or Gmail is not connected')

  let summary: SyncSummary
  let truncated = false
  try {
    const token = await accessToken(conn)
    const since = conn.last_success_at
      ? new Date(conn.last_success_at).getTime() - OVERLAP_DAYS * 86400_000
      : Date.now() - BACKFILL_DAYS * 86400_000
    const listed = await listMessageIds(token, gmailQuery(Math.floor(since / 1000)), MAX_MESSAGES_PER_SYNC)
    truncated = listed.truncated

    // Skip messages already handled; only transient errors get another try.
    const known = await db()`
      SELECT gmail_message_id, processing_status, attempts FROM gmail_messages
      WHERE user_id = ${userId} AND gmail_message_id = ANY(${listed.ids}::text[])`
    const done = new Set(
      known
        .filter((m) => m.processing_status !== 'ERROR' || m.attempts >= MAX_ATTEMPTS)
        .map((m) => m.gmail_message_id),
    )
    const todo = listed.ids.filter((id) => !done.has(id))

    summary = { ...empty('SUCCESS'), found: listed.ids.length, duplicates: done.size }
    const ctx = await loadContext(userId)
    const byBank: Record<string, number> = {}

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
      const outcomes = await Promise.all(todo.slice(i, i + CONCURRENCY).map((id) => processOne(ctx, token, id)))
      for (const o of outcomes) {
        if (o.bank && o.status !== 'IGNORED') byBank[o.bank] = (byBank[o.bank] ?? 0) + 1
        if (o.status === 'IMPORTED') summary.imported++
        else if (o.status === 'RECORDED') summary.recorded++
        else if (o.status === 'NEEDS_REVIEW') summary.review++
        else if (o.status === 'DUPLICATE') summary.duplicates++
        else if (o.status === 'IGNORED') summary.ignored++
        else summary.failed++
      }
    }
    if (summary.failed > 0 || truncated) summary.status = 'PARTIAL'
    const banks = Object.entries(byBank).map(([b, n]) => `${b.toLowerCase()}=${n}`).join(' ')
    log(
      userId,
      `found=${summary.found} new=${todo.length} ${banks} imported=${summary.imported} credits=${summary.recorded} ` +
        `review=${summary.review} duplicates=${summary.duplicates} ignored=${summary.ignored} failed=${summary.failed}`,
    )
  } catch (err) {
    const revoked = err instanceof GoogleApiError && err.code === 'invalid_grant'
    summary = revoked
      ? empty('REAUTH_REQUIRED', 'Google access was revoked or expired. Please reconnect Gmail.')
      : empty('FAILED', safeError(err))
    log(userId, `sync failed: ${summary.error}`)
  }

  // A truncated run leaves the window where it was so the next run picks up the rest.
  const advance = summary.status === 'SUCCESS' || (summary.status === 'PARTIAL' && !truncated)
  await db()`
    UPDATE gmail_connections SET
      sync_started_at = NULL,
      status = CASE WHEN ${summary.status} = 'REAUTH_REQUIRED' THEN 'REAUTH_REQUIRED' ELSE status END,
      last_sync_at = now(),
      last_success_at = CASE WHEN ${advance}::boolean THEN now() ELSE last_success_at END,
      last_sync_status = ${summary.status},
      last_sync_error = ${summary.error ?? null},
      last_sync_imported = ${summary.imported},
      last_sync_skipped = ${summary.duplicates},
      last_sync_review = ${summary.review},
      last_sync_failed = ${summary.failed},
      updated_at = now()
    WHERE id = ${conn.id}`
  return summary
}

// Errors are isolated per message so one bad email never stops the sync.
async function processOne(ctx: Awaited<ReturnType<typeof loadContext>>, token: string, id: string): Promise<Outcome | { status: 'ERROR'; bank: null }> {
  try {
    const email = toEmailMessage(await getMessage(token, id))
    return await processEmail(ctx, email)
  } catch (err) {
    const error = safeError(err)
    await recordMessage(ctx.userId, { id, threadId: null, from: '', subject: '', receivedAt: new Date() }, 'ERROR', null, error).catch(
      () => undefined,
    )
    log(ctx.userId, `message ••${id.slice(-6)} failed: ${error}`)
    return { status: 'ERROR', bank: null }
  }
}

// Google error messages never contain tokens, but keep stored/logged errors short anyway.
function safeError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/ya29\.[\w.-]+|1\/\/[\w.-]+/g, '[token]').slice(0, 300)
}

// Scheduled entry point: every active connection not synced within the interval.
export async function syncAllDue() {
  await ensureSchema()
  const due = await db()`
    SELECT user_id FROM gmail_connections
    WHERE status = 'ACTIVE'
      AND (last_sync_at IS NULL OR last_sync_at < now() - make_interval(mins => ${SYNC_INTERVAL_MINUTES}))
    ORDER BY last_sync_at NULLS FIRST`
  const results: { userId: number; status: SyncSummary['status'] }[] = []
  for (const { user_id } of due) {
    const s = await syncUser(user_id)
    results.push({ userId: user_id, status: s.status })
  }
  return results
}
