import { PatternParser } from './common'

// Confirmed against sanitized real emails (tests/fixtures/hdfc/):
//   debit_upi.html  "Rs.360.00 is debited from your account ending 1234 towards VPA x@pty (SHOP NAME) on 03-10-26."
//                   "UPI transaction reference no.: 123456789012."
//   credit.html     "Rs.23834.00 has been successfully credited to your HDFC Bank account ending in 1234."
//                   "Date: 01-10-26" / "Sender: NAME (VPA: x@ybl)" / "UPI Reference No.: 123456789012"
// Other HDFC wordings (e.g. card alerts) still parse via generic patterns but go to review
// until a real sample of each is added.
export class HDFCParser extends PatternParser {
  constructor() {
    super('HDFC', false, {
      merchant: [
        /\btowards\s+vpa\s+\S+@[a-z0-9]+\s+\(([^)]+)\)/i,
        /\bsender\s*:\s*(.+?)\s*\(\s*vpa\b/i,
        /\bvpa\s+[a-z0-9._-]+@[a-z0-9]+\s+(.+?)\s+on\b/i,
      ],
      reference: [
        /\bupi\s+(?:transaction\s+)?reference\s+no\.?\s*:?\s*(\d{6,30})\b/i,
        /\breference\s+number\s+is\s*:?\s*([a-z0-9]{6,30})\b/i,
      ],
      verified: [
        /\bis\s+debited\s+from\s+your\s+account\s+ending\s+\d{4}\s+towards\s+vpa\b/i,
        /\bhas\s+been\s+successfully\s+credited\s+to\s+your\s+hdfc\s+bank\s+account\s+ending\s+in\s+\d{4}\b/i,
      ],
    })
  }
}
