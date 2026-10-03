import { PatternParser } from './common'

// SBI-specific wording goes here once confirmed against sanitized real SBI emails.
// Until then `verified` stays false and every SBI import waits in the review queue.
export class SBIParser extends PatternParser {
  constructor() {
    super('SBI', false, {
      amount: [/\b(?:debited|credited)\s+(?:by|for)\s+(?:rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i],
      merchant: [/\btrf\s+to\s+(.+?)\s+(?:ref|on)\b/i, /\btransfer\s+(?:to|from)\s+(.+?)\s+(?:ref|on)\b/i],
      reference: [/\bref\s*no\.?\s*[:\-]?\s*(\d{6,22})\b/i],
      debit: [/\bhas\s+a\s+debit\b/i],
      credit: [/\bhas\s+a\s+credit\b/i],
    })
  }
}
