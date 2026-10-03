import { NextResponse, type NextRequest } from 'next/server'
import { ingestSms, userForSmsToken } from '@/lib/import/sms'

// Called by an iPhone Shortcuts automation for each bank SMS. Auth is the member's SMS token
// (Authorization: Bearer sms_...). Body: JSON { "sender": "...", "message": "..." }.
export async function POST(request: NextRequest) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  const userId = await userForSmsToken(token)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { sender?: unknown; message?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Send JSON: { "sender": "...", "message": "..." }' }, { status: 400 })
  }
  const message = typeof body.message === 'string' ? body.message.slice(0, 2000) : ''
  const sender = typeof body.sender === 'string' ? body.sender : ''
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })

  const result = await ingestSms(userId, sender, message)
  return NextResponse.json({ status: result.status })
}
