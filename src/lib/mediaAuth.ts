import { createHmac, timingSafeEqual } from 'node:crypto'

// Signed media URLs: let <img> tags fetch /media/:file without putting a session
// token in the URL. The signature is an HMAC over `file|expires` keyed by a
// server-side secret. Requests without a valid signature fall through to the
// bearer-token ownership check in the media route.
const SECRET = process.env.MEDIA_URL_SECRET || process.env.MASTER_ENCRYPTION_KEY || 'dev-media-secret'

// How long a signed media URL stays valid. Stored image URLs are signed once
// and reused, so a short TTL caused every image older than 15m to 401 in the
// UI. Default to 7 days; override with MEDIA_URL_TTL_MS.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000
const TTL_MS = Number(process.env.MEDIA_URL_TTL_MS) || DEFAULT_TTL_MS

function sign(file: string, expires: number): string {
  return createHmac('sha256', SECRET).update(`${file}|${expires}`).digest('hex')
}

export function signMediaUrl(file: string, baseUrl: string, ttlMs = TTL_MS): string {
  const expires = Date.now() + ttlMs
  const sig = sign(file, expires)
  const sep = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${sep}expires=${expires}&sig=${sig}`
}

export function verifyMediaUrl(file: string, expires: unknown, sig: unknown): boolean {
  if (typeof expires !== 'string' || typeof sig !== 'string') return false
  const exp = Number(expires)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const expected = Buffer.from(sign(file, exp))
  const provided = Buffer.from(sig)
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}