// Errors from Google APIs. `retryable` marks rate limits, server errors and network failures,
// which are worth retrying; anything else (bad request, revoked access) is not.
export class GoogleApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly retryable: boolean

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = 'GoogleApiError'
    this.status = status
    this.code = code
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const retryPolicy = { attempts: 4, baseDelayMs: 500 }

// fetch with exponential backoff (0.5s, 1s, 2s + jitter) for transient failures only.
export async function fetchWithRetry(url: string, init: RequestInit = {}) {
  for (let attempt = 1; ; attempt++) {
    let error: GoogleApiError
    try {
      const res = await fetch(url, init)
      if (res.ok) return res
      const body = await res.json().catch(() => ({}) as Record<string, unknown>)
      const code = typeof body.error === 'string' ? body.error : (body.error?.status ?? null)
      const message = body.error_description ?? body.error?.message ?? res.statusText
      error = new GoogleApiError(`Google API ${res.status}: ${message}`, res.status, code)
    } catch (err) {
      if (err instanceof GoogleApiError) throw err
      error = new GoogleApiError(`Network error: ${(err as Error).message}`, 0)
    }
    if (!error.retryable || attempt >= retryPolicy.attempts) throw error
    await sleep(retryPolicy.baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100)
  }
}
