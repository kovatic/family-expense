import type {
  BankCode,
  BankTransactionParser,
  EmailMessage,
  ParseResult,
  ParsedTransaction,
  TransactionType,
} from '../types'
import { matchesBank } from '../rules'
import { flatten } from '../text'

// Building blocks shared by bank parsers. Each parser passes its own label patterns first;
// the generic fallbacks here only run when those find nothing.

const NUM = String.raw`([0-9][0-9,]*(?:\.[0-9]{1,2})?)`
const CURRENCY = String.raw`(?:rs\.?|inr)`
const ANY_AMOUNT = new RegExp(String.raw`${CURRENCY}\s*${NUM}`, 'gi')

export const GENERIC_AMOUNT_PATTERNS = [
  new RegExp(String.raw`\b(?:debited|credited)\s+(?:by|for|with)\s+${CURRENCY}?\s*${NUM}`, 'i'),
  new RegExp(
    String.raw`${CURRENCY}\s*${NUM}\s+(?:has been|have been|is|was)?\s*(?:successfully\s+)?(?:debited|credited|spent|paid|received|deposited|withdrawn)`,
    'i',
  ),
  new RegExp(String.raw`\b(?:debit|credit|spent|paid|payment|withdrawal|purchase)\s+(?:of|for)\s+${CURRENCY}\s*${NUM}`, 'i'),
  new RegExp(String.raw`\bamount\s*(?:debited|credited|paid)?\s*[:\-]?\s*${CURRENCY}?\s*${NUM}`, 'i'),
]

export function toAmount(raw: string | undefined) {
  if (!raw) return null
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null
}

export function findAmount(text: string, patterns: RegExp[]) {
  for (const re of [...patterns, ...GENERIC_AMOUNT_PATTERNS]) {
    const amount = toAmount(text.match(re)?.[1])
    if (amount) return amount
  }
  // Last resort: first currency amount that isn't a balance or limit.
  for (const m of text.matchAll(ANY_AMOUNT)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 30), m.index).toLowerCase()
    if (/\b(bal|balance|avl|available|limit|outstanding|due)\b/.test(before)) continue
    const amount = toAmount(m[1])
    if (amount) return amount
  }
  return null
}

const DEBIT_WORDS = /\b(debited|debit|spent|withdrawn|withdrawal|paid|sent|purchase|deducted)\b/i
const CREDIT_WORDS = /\b(credited|credit|received|deposited|refund|refunded|reversed|reversal)\b/i

// "Credit card" / "debit card" name a product, not the direction of money.
const stripCardWords = (text: string) => text.replace(/\b(credit|debit)\s*(card|limit|score)s?\b/gi, ' ')

// Uses wording only, never the amount's sign. The first debit/credit word wins because
// alerts like "your a/c is debited ... and credited to <payee>" lead with the account's side.
export function detectType(text: string, debitFirst: RegExp[] = [], creditFirst: RegExp[] = []): TransactionType | null {
  if (debitFirst.some((re) => re.test(text))) return 'DEBIT'
  if (creditFirst.some((re) => re.test(text))) return 'CREDIT'
  if (/\bthank you for using your\b.{0,60}?\bcard\b/i.test(text)) return 'DEBIT'
  const cleaned = stripCardWords(text)
  const d = cleaned.search(DEBIT_WORDS)
  const c = cleaned.search(CREDIT_WORDS)
  if (d < 0 && c < 0) return null
  if (c < 0) return 'DEBIT'
  if (d < 0) return 'CREDIT'
  return d < c ? 'DEBIT' : 'CREDIT'
}

export function hasTransactionWords(text: string) {
  const cleaned = stripCardWords(text)
  return DEBIT_WORDS.test(cleaned) || CREDIT_WORDS.test(cleaned)
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const pad = (n: number) => String(n).padStart(2, '0')

function makeDate(y: number, m: number, d: number) {
  if (y < 100) y += 2000
  if (m < 1 || m > 12 || d < 1) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

const DATE_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => string | null }[] = [
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, build: (m) => makeDate(+m[1], +m[2], +m[3]) },
  // Indian alerts use day-first numeric dates.
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, build: (m) => makeDate(+m[3], +m[2], +m[1]) },
  {
    re: /\b(\d{1,2})[-\s]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[-\s,]*(\d{4}|\d{2})\b/i,
    build: (m) => makeDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]),
  },
  {
    re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})\b/i,
    build: (m) => makeDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]),
  },
]

// Accepts only dates near the email's arrival, which also catches day/month mix-ups.
export function findDate(text: string, receivedAt: Date) {
  const latest = receivedAt.getTime() + 2 * 86400_000
  const earliest = receivedAt.getTime() - 120 * 86400_000
  const plausible = (iso: string | null) => {
    if (!iso) return null
    const t = Date.parse(`${iso}T00:00:00Z`)
    return t >= earliest && t <= latest ? iso : null
  }
  // Prefer a date introduced by "on" ("debited ... on 03-10-26").
  for (const { re, build } of DATE_PATTERNS) {
    const near = new RegExp(String.raw`\b(?:on|dated?)\s*(?:date\s*)?[:\-]?\s*` + re.source.replace(/^\\b/, ''), re.flags)
    const m = text.match(near)
    const iso = plausible(m ? build(m) : null)
    if (iso) return iso
  }
  for (const { re, build } of DATE_PATTERNS) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags + 'g'))) {
      const iso = plausible(build(m))
      if (iso) return iso
    }
  }
  return null
}

export function findTime(text: string) {
  const m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\s*(am|pm)?\b/i)
  if (!m) return null
  let h = Number(m[1])
  const ampm = m[4]?.toLowerCase()
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  return `${pad(h)}:${m[2]}:${m[3] ?? '00'}`
}

export function findAccountLast4(text: string) {
  const patterns = [
    /\b(?:a\/c|a\/c\.|ac|acct|account)\s*(?:no\.?|number)?\s*[:\-]?\s*(?:ending\s*(?:in|with)?\s*)?[x*•.]+\s*(\d{3,4})\b/i,
    /\b(?:a\/c|ac|acct|account)\s*(?:no\.?|number)?\s*(?:ending|ends)\s*(?:in|with)?\s*(\d{4})\b/i,
    /\bcard\s*(?:no\.?)?\s*(?:ending|ends)\s*(?:in|with)?\s*[x*]*(\d{4})\b/i,
    /\bcard\s*(?:no\.?)?\s*[x*•]+(\d{4})\b/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) return m[1]
  }
  return null
}

const REF_PATTERNS = [
  /\b(?:upi\s*)?(?:transaction\s*)?ref(?:erence)?\.?\s*(?:no|num|number|id)?\.?\s*(?:is\s*)?[:#\-]?\s*([a-z0-9]*\d[a-z0-9]{5,29})\b/i,
  /\btxn\s*(?:id|no)\.?\s*[:#\-]?\s*([a-z0-9]*\d[a-z0-9]{5,29})\b/i,
]

export function findReference(text: string, patterns: RegExp[] = []) {
  const utr = text.match(/\butr\s*(?:no|number)?\.?\s*(?:is\s*)?[:#\-]?\s*([a-z0-9]{8,30})\b/i)?.[1] ?? null
  let reference: string | null = null
  for (const re of [...patterns, ...REF_PATTERNS]) {
    const m = text.match(re)
    if (m) {
      reference = m[1]
      break
    }
  }
  reference = (reference ?? utr)?.toUpperCase() ?? null
  // A 12-digit UPI reference is the UTR.
  const upiUtr = !utr && reference && /^\d{12}$/.test(reference) && /\bupi\b/i.test(text) ? reference : null
  return { reference, utr: (utr ?? upiUtr)?.toUpperCase() ?? null }
}

const UPI_ID = /([a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63})(?![a-z0-9.@-])/i

export function findUpiId(text: string) {
  const labelled = text.match(new RegExp(String.raw`\b(?:vpa|upi\s*id)\s*[:\-]?\s*` + UPI_ID.source, 'i'))
  if (labelled) return labelled[1].toLowerCase()
  for (const m of text.matchAll(new RegExp(UPI_ID.source, 'gi'))) {
    // Skip email addresses (handle followed by a dot-domain was excluded above; also skip
    // anything that looks like part of a URL).
    const before = text[(m.index ?? 0) - 1] ?? ' '
    if (/[\w/:]/.test(before)) continue
    return m[1].toLowerCase()
  }
  return null
}

export const GENERIC_MERCHANT_PATTERNS = [
  /\bvpa\s+[a-z0-9._-]+@[a-z0-9]+\s+(.+?)\s+(?:on|dated?)\b/i,
  /\bupi\/(?:p2[am]\/)?(?:\d+\/)?([^/\n]+?)(?:\/|\s{2}|$)/i,
  /\btrf\s+to\s+(.+?)\s+(?:ref|on)\b/i,
  /\b(?:at|to)\s+(.+?)\s+on\s+(?:date\s+)?\d/i,
  /\b(?:at|to)\s+(.+?)\s+(?:on|dated?)\b/i,
  /\b(?:from|by)\s+(.+?)\s+on\s+(?:date\s+)?\d/i,
  /\binfo\s*[:\-]\s*(.+?)(?:\.\s|$)/i,
]

function cleanMerchant(raw: string | undefined) {
  if (!raw) return null
  const s = raw
    .replace(/\bvpa\s+\S+@\S+\s*/i, '')
    .replace(/^[\s:.,\-(]+|[\s:.,\-)]+$/g, '')
    .slice(0, 80)
  if (s.length < 2 || !/[a-z]/i.test(s)) return null
  // Phrases about the user's own account, not a counterparty.
  if (/\b(your|a\/c|account|acct|card|xx+|\*\*+)\b/i.test(s) || /^(you|us|me)$/i.test(s)) return null
  return s
}

export function findMerchant(text: string, patterns: RegExp[] = []) {
  for (const re of [...patterns, ...GENERIC_MERCHANT_PATTERNS]) {
    const name = cleanMerchant(text.match(re)?.[1])
    if (name) return name
  }
  return null
}

export type ParserPatterns = {
  amount?: RegExp[]
  merchant?: RegExp[]
  reference?: RegExp[]
  debit?: RegExp[]
  credit?: RegExp[]
  // Wordings confirmed against sanitized real emails (see tests/fixtures).
  verified?: RegExp[]
}

// Turns an email into a ParsedTransaction using the bank's patterns plus generic fallbacks.
// Amount and debit/credit are required; a date falls back to when the email arrived.
export function parseWithPatterns(bank: BankCode, email: EmailMessage, p: ParserPatterns): ParseResult {
  const text = flatten(`${email.subject}. ${email.text}`)
  const body = flatten(email.text)
  const amount = findAmount(body, p.amount ?? []) ?? findAmount(text, p.amount ?? [])
  const type = detectType(body, p.debit, p.credit) ?? detectType(text, p.debit, p.credit)

  if (!amount && !type) return { ok: false, status: 'NOT_TRANSACTION', error: 'No amount or debit/credit wording' }
  if (!hasTransactionWords(text) && !type) {
    return { ok: false, status: 'NOT_TRANSACTION', error: 'No debit/credit wording' }
  }
  if (!amount) return { ok: false, status: 'PARSE_FAILED', error: 'Amount not found' }
  if (!type) return { ok: false, status: 'PARSE_FAILED', error: 'Could not tell debit from credit' }

  let confidence = 1
  const foundDate = findDate(body, email.receivedAt)
  const date = foundDate ?? receivedDate(email.receivedAt)
  if (!foundDate) confidence -= 0.2
  const merchant = findMerchant(body, p.merchant)
  if (!merchant) confidence -= 0.1
  const { reference, utr } = findReference(body, p.reference)
  if (!reference) confidence -= 0.1

  const transaction: ParsedTransaction = {
    bank,
    transactionType: type,
    amount,
    currency: 'INR',
    transactionDate: date,
    transactionTime: findTime(body),
    merchantName: merchant,
    description: describe(body),
    referenceNumber: reference,
    utr,
    upiId: findUpiId(body),
    accountLast4: findAccountLast4(body),
    sourceMessageId: email.id,
    confidence: Math.max(0, Math.round(confidence * 100) / 100),
    verifiedFormat: (p.verified ?? []).some((re) => re.test(body)),
  }
  return { ok: true, transaction }
}

// The sentence that mentions the transaction, for display. Long digit runs (account, phone,
// VPA numbers) are masked; amounts ("Rs.23834.00") are left alone.
function describe(text: string) {
  const sentence =
    text.split(/(?<=[.!?])\s+(?=[A-Z])/).find((s) => DEBIT_WORDS.test(s) || CREDIT_WORDS.test(s)) ?? text
  return sentence.replace(/(?<!rs\.?\s?)(?<![\d.,])\d{6,}(?![\d,]|\.\d)/gi, (d) => `••${d.slice(-4)}`).slice(0, 300)
}

const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
export const receivedDate = (d: Date) => IST_DATE.format(d)

export class PatternParser implements BankTransactionParser {
  readonly bank: BankCode
  readonly verified: boolean
  private readonly patterns: ParserPatterns

  constructor(bank: BankCode, verified: boolean, patterns: ParserPatterns) {
    this.bank = bank
    this.verified = verified
    this.patterns = patterns
  }

  canParse(email: EmailMessage) {
    return matchesBank(this.bank, email.from, email.subject)
  }

  parse(email: EmailMessage): ParseResult {
    const result = parseWithPatterns(this.bank, email, this.patterns)
    if (result.ok && this.verified) result.transaction.verifiedFormat = true
    return result
  }
}
