export type BankCode = 'SBI' | 'HDFC'
export type TransactionType = 'DEBIT' | 'CREDIT'

// A Gmail message reduced to what parsers need. `text` is the decoded, normalized body.
export type EmailMessage = {
  // 'SMS' for bank SMS forwarded from a phone; `from` is then 'sms:<sender id>'.
  source?: 'GMAIL' | 'SMS'
  id: string
  threadId: string | null
  from: string
  subject: string
  receivedAt: Date
  text: string
}

// The one shape every bank parser returns; nothing downstream knows about bank email formats.
export type ParsedTransaction = {
  bank: BankCode
  transactionType: TransactionType
  amount: number
  currency: 'INR'
  transactionDate: string // YYYY-MM-DD
  transactionTime: string | null // HH:MM:SS
  merchantName: string | null
  description: string
  referenceNumber: string | null
  utr: string | null
  upiId: string | null
  accountLast4: string | null
  sourceMessageId: string
  confidence: number
  // True when the email matched a wording confirmed against a sanitized real sample.
  verifiedFormat: boolean
}

export type ParseResult =
  | { ok: true; transaction: ParsedTransaction }
  | { ok: false; status: 'NOT_TRANSACTION' | 'PARSE_FAILED'; error: string }

export interface BankTransactionParser {
  readonly bank: BankCode
  // True only if every format this parser accepts has been checked against real emails.
  // Otherwise only results with `verifiedFormat` may create expenses on their own.
  readonly verified: boolean
  canParse(email: EmailMessage): boolean
  parse(email: EmailMessage): ParseResult
}
