import type { EmailMessage } from '@/lib/import/types'
import { htmlToText, normalizeText } from '@/lib/import/text'

// Subset of the Gmail API `users.messages.get?format=full` response that we read.
export type GmailPart = {
  mimeType?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}
export type GmailMessage = {
  id: string
  threadId?: string
  internalDate?: string
  payload?: GmailPart
}

const decode = (data: string) => Buffer.from(data, 'base64url').toString('utf8')

function collect(part: GmailPart | undefined, out: { plain: string[]; html: string[] }) {
  if (!part) return
  const type = (part.mimeType ?? '').toLowerCase()
  if (part.body?.data) {
    if (type === 'text/plain') out.plain.push(decode(part.body.data))
    else if (type === 'text/html') out.html.push(decode(part.body.data))
  }
  for (const p of part.parts ?? []) collect(p, out)
}

export function header(msg: GmailMessage, name: string) {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return h?.value ?? ''
}

// Bank alerts are mostly HTML with a thin or missing plain-text part, so HTML wins when
// it carries more text.
export function extractText(msg: GmailMessage) {
  const out = { plain: [] as string[], html: [] as string[] }
  collect(msg.payload, out)
  const plain = normalizeText(out.plain.join('\n'))
  const html = normalizeText(out.html.map(htmlToText).join('\n'))
  return html.length > plain.length ? html : plain
}

export function toEmailMessage(msg: GmailMessage): EmailMessage {
  return {
    id: msg.id,
    threadId: msg.threadId ?? null,
    from: header(msg, 'From'),
    subject: header(msg, 'Subject'),
    receivedAt: new Date(Number(msg.internalDate) || Date.parse(header(msg, 'Date')) || Date.now()),
    text: extractText(msg),
  }
}
