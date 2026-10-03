import { fetchWithRetry } from './http'

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export function isGmailConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function config(origin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set')
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/integrations/gmail/callback`
  return { clientId, clientSecret, redirectUri }
}

export function buildAuthUrl(state: string, origin: string) {
  const { clientId, redirectUri } = config(origin)
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    // Offline access + forced consent so Google always returns a refresh token.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  })
  return `${AUTH_URL}?${params}`
}

export type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date; scope: string }

async function tokenRequest(params: Record<string, string>): Promise<Tokens> {
  const res = await fetchWithRetry(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  })
  const json = await res.json()
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (Number(json.expires_in) || 3600) * 1000),
    scope: json.scope ?? '',
  }
}

export function exchangeCode(code: string, origin: string) {
  const { clientId, clientSecret, redirectUri } = config(origin)
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
}

export function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = config()
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
}

export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined)
}
