import type { GmailMessage } from './body'
import { fetchWithRetry } from './http'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

async function get<T>(token: string, path: string): Promise<T> {
  const res = await fetchWithRetry(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return res.json() as Promise<T>
}

export function getProfile(token: string) {
  return get<{ emailAddress: string; historyId: string }>(token, '/profile')
}

// Newest first. Stops at `max`; `truncated` says whether more matches remain.
export async function listMessageIds(token: string, q: string, max: number) {
  const ids: string[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await get<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${params}`)
    ids.push(...(page.messages ?? []).map((m) => m.id))
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < max)
  return { ids, truncated: Boolean(pageToken) }
}

export function getMessage(token: string, id: string) {
  return get<GmailMessage>(token, `/messages/${encodeURIComponent(id)}?format=full`)
}
