import { NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { buildAuthUrl, isGmailConfigured } from '@/lib/gmail/oauth'
import { signOAuthState } from '@/lib/jwt'

export async function GET(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  if (!isGmailConfigured()) return NextResponse.redirect(new URL('/bank?error=not_configured', request.url))
  const url = buildAuthUrl(await signOAuthState(user.id), request.nextUrl.origin)
  return NextResponse.redirect(url)
}
