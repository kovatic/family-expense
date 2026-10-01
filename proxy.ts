import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/jwt'

const PUBLIC_PATHS = ['/login', '/setup']

// Optimistic check only; pages and actions verify the user against the DB.
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  const uid = await verifySession(request.cookies.get(SESSION_COOKIE)?.value)
  if (!uid) return NextResponse.redirect(new URL('/login', request.url))
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|icons/|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|offline.html).*)',
  ],
}
