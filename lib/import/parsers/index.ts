import type { BankTransactionParser, EmailMessage, ParseResult } from '../types'
import { HDFCParser } from './hdfc'
import { SBIParser } from './sbi'

// Register new banks here (ICICIParser, AxisParser, ...); nothing else needs to change.
export const PARSERS: BankTransactionParser[] = [new SBIParser(), new HDFCParser()]

export type EmailOutcome =
  | { parser: null; result: { ok: false; status: 'NOT_TRANSACTION'; error: string } }
  | { parser: BankTransactionParser; result: ParseResult }

export function parseEmail(email: EmailMessage, parsers = PARSERS): EmailOutcome {
  const parser = parsers.find((p) => p.canParse(email))
  if (!parser) return { parser: null, result: { ok: false, status: 'NOT_TRANSACTION', error: 'Not from a known bank' } }
  try {
    return { parser, result: parser.parse(email) }
  } catch (err) {
    return { parser, result: { ok: false, status: 'PARSE_FAILED', error: `Parser error: ${(err as Error).message}` } }
  }
}
