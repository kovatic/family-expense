import type { Query, Sql } from './db'

export type Migration = { version: number; name: string; up: (sql: Sql) => Query[] }

// Append only. Statements must stay idempotent (IF NOT EXISTS) because a migration
// that lost the race to another instance re-runs harmlessly before recording itself.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'gmail_bank_import',
    up: (sql) => [
      sql`CREATE TABLE IF NOT EXISTS gmail_connections (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        gmail_email TEXT NOT NULL,
        access_token_encrypted TEXT,
        refresh_token_encrypted TEXT NOT NULL,
        token_expiry TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        last_history_id TEXT,
        watch_expiry TIMESTAMPTZ,
        sync_started_at TIMESTAMPTZ,
        last_sync_at TIMESTAMPTZ,
        last_sync_status TEXT,
        last_sync_error TEXT,
        last_sync_imported INT NOT NULL DEFAULT 0,
        last_sync_skipped INT NOT NULL DEFAULT 0,
        last_sync_review INT NOT NULL DEFAULT 0,
        last_sync_failed INT NOT NULL DEFAULT 0,
        last_success_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`CREATE TABLE IF NOT EXISTS gmail_messages (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        gmail_message_id TEXT NOT NULL,
        gmail_thread_id TEXT,
        sender TEXT,
        subject TEXT,
        received_at TIMESTAMPTZ,
        message_hash TEXT,
        bank_detected TEXT,
        processing_status TEXT NOT NULL,
        processing_error TEXT,
        attempts INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, gmail_message_id)
      )`,
      sql`CREATE INDEX IF NOT EXISTS gmail_messages_status_idx ON gmail_messages (user_id, processing_status)`,
      sql`CREATE TABLE IF NOT EXISTS bank_transactions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bank TEXT NOT NULL,
        account_last4 TEXT,
        transaction_date DATE NOT NULL,
        transaction_datetime TIMESTAMPTZ,
        transaction_type TEXT NOT NULL CHECK (transaction_type IN ('DEBIT', 'CREDIT')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'INR',
        merchant_name TEXT,
        original_description TEXT,
        description TEXT,
        reference_number TEXT,
        utr TEXT,
        upi_id TEXT,
        source TEXT NOT NULL DEFAULT 'GMAIL',
        source_message_id TEXT,
        category TEXT,
        confidence_score NUMERIC(3,2),
        status TEXT NOT NULL,
        review_reason TEXT,
        transaction_fingerprint TEXT NOT NULL,
        raw_payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_ref_idx
        ON bank_transactions (user_id, bank, reference_number) WHERE reference_number IS NOT NULL`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_fingerprint_idx
        ON bank_transactions (user_id, transaction_fingerprint) WHERE reference_number IS NULL`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_message_idx
        ON bank_transactions (user_id, source_message_id) WHERE source_message_id IS NOT NULL`,
      sql`CREATE INDEX IF NOT EXISTS bank_transactions_status_idx ON bank_transactions (user_id, status)`,
      sql`CREATE TABLE IF NOT EXISTS merchant_rules (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        merchant TEXT NOT NULL,
        category TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (user_id, merchant)
      )`,
      sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS bank_transaction_id INT
        REFERENCES bank_transactions(id) ON DELETE SET NULL`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS expenses_bank_transaction_idx
        ON expenses (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL`,
    ],
  },
  {
    version: 2,
    name: 'sms_import',
    up: (sql) => [
      // gmail_messages also tracks forwarded SMS (gmail_message_id = 'sms:<hash>').
      sql`ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'GMAIL'`,
      sql`CREATE TABLE IF NOT EXISTS sms_ingest_tokens (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_used_at TIMESTAMPTZ
      )`,
    ],
  },
]
