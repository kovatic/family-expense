import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractText } from '@/lib/gmail/body'
import { decodeEntities, htmlToText, normalizeText } from '@/lib/import/text'
import { gmailMessage } from '../helpers'

test('decodes named and numeric HTML entities', () => {
  assert.equal(decodeEntities('A &amp; B &#8377;5 &#x20B9;6 &nbsp;&unknown;'), 'A & B ₹5 ₹6  &unknown;')
})

test('HTML to text drops style/script and keeps line structure', () => {
  const text = normalizeText(htmlToText('<style>x{}</style><p>Hello</p><div>World<br>again</div><td>a</td><td>b</td>'))
  assert.equal(text, 'Hello\nWorld\nagain\na b')
})

test('normalizes rupee symbol, NBSP and whitespace', () => {
  assert.equal(normalizeText('₹450 debited   \r\n\r\n\r\nok​'), 'Rs. 450 debited\nok')
})

test('extracts the HTML part when it carries more text than plain', () => {
  const msg = gmailMessage('m1', 'From: a@b.c\nSubject: s\n\n<p>Rs.10 debited from your account today</p>')
  msg.payload!.parts!.push({ mimeType: 'text/plain', body: { data: Buffer.from('See HTML').toString('base64url') } })
  assert.equal(extractText(msg), 'Rs.10 debited from your account today')
})
