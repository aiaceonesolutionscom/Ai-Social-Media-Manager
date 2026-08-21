import { randomBytes } from 'node:crypto'

// Short-lived, single-use codes used to hand a value across a browser redirect
// without ever putting it in a URL query string. A token/code minted here can
// only be redeemed once and expires within a couple of minutes.
const store = new Map<string, { value: string; expiresAt: number }>()

export function createShortLivedCode(value: string, ttlMs = 120_000): string {
  const code = randomBytes(24).toString('hex')
  store.set(code, { value, expiresAt: Date.now() + ttlMs })
  return code
}

export function consumeShortLivedCode(code: string): string | undefined {
  if (!code) return undefined
  const entry = store.get(code)
  if (!entry) return undefined
  store.delete(code)
  if (Date.now() > entry.expiresAt) return undefined
  return entry.value
}

export function resetShortLivedCodes(): void {
  store.clear()
}