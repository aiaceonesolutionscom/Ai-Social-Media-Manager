import { config } from '../config.js'
import { logger } from './logger.js'

export interface RetryOptions {
  attempts?: number
  baseDelayMs?: number
  timeoutMs?: number
  retryOn?: (status: number) => boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Providers like Mistral/OpenAI return a Retry-After header (seconds or an HTTP-date)
// when rate limited. Honor it when present so we don't hammer the API during the
// rate-limit window (Mistral 429 code 1300).
function retryAfterMs(res: Response): number | null {
  const header = res.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return null
}

const MAX_RATE_LIMIT_DELAY_MS = 30_000

// Rate limits are usually longer-lived than transient 5xx errors. Give 429s a
// longer exponential backoff (respecting Retry-After) plus a few extra attempts,
// while keeping network-error retries snappy.
function delayForStatus(status: number, attempt: number, baseDelayMs: number, res: Response): number {
  const base = status === 429 ? baseDelayMs * 2 ** (attempt + 1) : baseDelayMs * 2 ** (attempt - 1)
  const retryAfter = status === 429 ? retryAfterMs(res) : null
  const delay = retryAfter !== null ? Math.max(base, retryAfter) : base
  return Math.min(delay, MAX_RATE_LIMIT_DELAY_MS)
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const baseAttempts = opts.attempts ?? config.retry.attempts
  // Rate-limited responses get more chances: the window is often longer than a
  // couple of retries, so allow up to 5 total attempts when a 429 is seen.
  const rateLimitAttempts = Math.max(baseAttempts, 5)
  const baseDelayMs = opts.baseDelayMs ?? config.retry.baseDelayMs
  const timeoutMs = opts.timeoutMs ?? config.retry.timeoutMs
  const retryOn = opts.retryOn ?? ((status: number) => status >= 500 || status === 429)

  let lastError: Error | undefined
  let sawRateLimit = false
  const attemptsFor = (status: number) => (status === 429 ? rateLimitAttempts : baseAttempts)

  for (let attempt = 1; attempt <= (sawRateLimit ? rateLimitAttempts : baseAttempts); attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return res
      const status = res.status
      if (status === 429) sawRateLimit = true
      if (attempt < attemptsFor(status) && retryOn(status)) {
        const delay = delayForStatus(status, attempt, baseDelayMs, res)
        logger.warn({ url, status, attempt, delay }, 'http retryable status')
        await sleep(delay)
        continue
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      lastError = err as Error
      if (attempt < baseAttempts) {
        const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), MAX_RATE_LIMIT_DELAY_MS)
        logger.warn({ url, attempt, error: lastError.message, delay }, 'http retry after network error')
        await sleep(delay)
        continue
      }
    }
  }
  throw lastError ?? new Error(`Request failed after ${baseAttempts} attempts`)
}

export async function fetchJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<T> {
  const res = await fetchWithRetry(url, init, opts)
  const body = (await res.json().catch(() => ({}))) as T
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}
