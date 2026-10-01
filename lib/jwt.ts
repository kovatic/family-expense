import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'fe_session'
export const SESSION_DAYS = 30

function key() {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export function signSession(uid: number) {
  return new SignJWT({ uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key())
}

export async function verifySession(token: string | undefined): Promise<number | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, key())
    return typeof payload.uid === 'number' ? payload.uid : null
  } catch {
    return null
  }
}
