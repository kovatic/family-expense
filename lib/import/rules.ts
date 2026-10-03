import type { BankCode } from './types'

// Which emails count as candidate bank alerts. Matching is by sender domain until real
// sanitized emails confirm exact sender addresses and subjects; add them to `senders` and
// `subjects` then. An empty list means "don't filter on this".
// `smsSenders` matches the SMS sender ID (e.g. "XX-SBIUPI") of messages forwarded from a phone.
export const BANK_RULES: Record<
  BankCode,
  { senderDomains: string[]; senders: string[]; subjects: RegExp[]; smsSenders: RegExp[] }
> = {
  SBI: {
    senderDomains: ['sbi.co.in', 'sbi.bank.in'],
    senders: [],
    subjects: [],
    smsSenders: [/\bSBI/i],
  },
  HDFC: {
    senderDomains: ['hdfcbank.net', 'hdfcbank.com', 'hdfcbank.bank.in'],
    // Confirmed from a real UPI debit alert (2026-10-03).
    senders: ['alerts@hdfcbank.bank.in'],
    subjects: [],
    // HDFC already arrives by email; importing its SMS too could double count.
    smsSenders: [],
  },
}

export function senderAddress(from: string) {
  const m = from.match(/<([^>]+)>/)
  return (m ? m[1] : from).trim().toLowerCase()
}

export function matchesBank(bank: BankCode, from: string, subject: string) {
  const rule = BANK_RULES[bank]
  if (from.startsWith('sms:')) return rule.smsSenders.some((re) => re.test(from.slice(4)))
  const addr = senderAddress(from)
  const domain = addr.split('@')[1] ?? ''
  const senderOk =
    rule.senders.includes(addr) || rule.senderDomains.some((d) => domain === d || domain.endsWith(`.${d}`))
  if (!senderOk) return false
  return rule.subjects.length === 0 || rule.subjects.some((re) => re.test(subject))
}

// Gmail search narrowing the mailbox to likely alerts; the parsers make the final call.
export function gmailQuery(afterEpochSeconds: number) {
  const domains = Object.values(BANK_RULES).flatMap((r) => [...r.senderDomains, ...r.senders])
  return `from:(${domains.join(' OR ')}) {debited credited debit credit spent} after:${afterEpochSeconds}`
}
