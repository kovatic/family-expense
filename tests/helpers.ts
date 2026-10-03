import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toEmailMessage, type GmailMessage } from '@/lib/gmail/body'

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')

// Builds a Gmail API message (as users.messages.get returns it) from header/body text.
export function gmailMessage(id: string, raw: string): GmailMessage {
  const split = raw.indexOf('\n\n')
  const head = raw.slice(0, split)
  const body = raw.slice(split + 2)
  const headers = head.split('\n').map((line) => {
    const i = line.indexOf(':')
    return { name: line.slice(0, i), value: line.slice(i + 1).trim() }
  })
  const date = headers.find((h) => h.name === 'Date')?.value
  const isHtml = body.trimStart().startsWith('<')
  return {
    id,
    threadId: `t-${id}`,
    internalDate: String(date ? Date.parse(date) : Date.now()),
    payload: {
      mimeType: 'multipart/alternative',
      headers,
      parts: [{ mimeType: isHtml ? 'text/html' : 'text/plain', body: { data: b64(body) } }],
    },
  }
}

export function fixture(path: string) {
  return readFileSync(join(import.meta.dirname, 'fixtures', path), 'utf8')
}

export function fixtureEmail(path: string, id = path) {
  return toEmailMessage(gmailMessage(id, fixture(path)))
}
