import { after, NextResponse, type NextRequest } from 'next/server'
import { getUser } from '@/lib/auth'
import { db, ensureSchema } from '@/lib/db'
import { getProfile } from '@/lib/gmail/client'
import { encryptToken } from '@/lib/gmail/crypto'
import { exchangeCode, GMAIL_SCOPE, revokeToken } from '@/lib/gmail/oauth'
import { verifyOAuthState } from '@/lib/jwt'
import { syncUser } from '@/lib/import/sync'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const back = (query: string) => NextResponse.redirect(new URL(`/bank?${query}`, request.url))
  const params = request.nextUrl.searchParams
  const user = await getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  if (params.get('error')) return back('error=denied')
  if ((await verifyOAuthState(params.get('state'))) !== user.id) return back('error=state')
  const code = params.get('code')
  if (!code) return back('error=denied')

  let tokens
  try {
    tokens = await exchangeCode(code, request.nextUrl.origin)
  } catch {
    return back('error=exchange')
  }
  if (!tokens.scope.split(' ').includes(GMAIL_SCOPE)) {
    await revokeToken(tokens.accessToken)
    return back('error=scope')
  }
  if (!tokens.refreshToken) return back('error=no_refresh')

  let profile
  try {
    profile = await getProfile(tokens.accessToken)
  } catch {
    return back('error=exchange')
  }
  await ensureSchema()
  await db()`
    INSERT INTO gmail_connections (user_id, gmail_email, access_token_encrypted, refresh_token_encrypted,
                                   token_expiry, status, last_history_id)
    VALUES (${user.id}, ${profile.emailAddress}, ${encryptToken(tokens.accessToken)},
            ${encryptToken(tokens.refreshToken)}, ${tokens.expiresAt.toISOString()}, 'ACTIVE', ${profile.historyId})
    ON CONFLICT (user_id) DO UPDATE SET
      gmail_email = EXCLUDED.gmail_email,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      token_expiry = EXCLUDED.token_expiry,
      status = 'ACTIVE',
      last_history_id = EXCLUDED.last_history_id,
      sync_started_at = NULL,
      updated_at = now()`

  // Initial backfill runs after the redirect so the user isn't kept waiting.
  after(() => syncUser(user.id).then(() => undefined))
  return back('connected=1')
}
