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

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = opts.attempts ?? config.retry.attempts
  const baseDelayMs = opts.baseDelayMs ?? config.retry.baseDelayMs
  const timeoutMs = opts.timeoutMs ?? config.retry.timeoutMs
  const retryOn = opts.retryOn ?? ((status: number) => status >= 500 || status === 429)

  let lastError: Error | undefined
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { ...init, signal: controller.signal })
      clearTimeout(timer)
      if (res.ok) return res
      const status = res.status
      if (attempt < attempts && retryOn(status)) {
        const delay = baseDelayMs * 2 ** (attempt - 1)
        logger.warn({ url, status, attempt, delay }, 'http retryable status')
        await sleep(delay)
        continue
      }
      return res
    } catch (err) {
      clearTimeout(timer)
      lastError = err as Error
      if (attempt < attempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1)
        logger.warn({ url, attempt, error: lastError.message, delay }, 'http retry after network error')
        await sleep(delay)
        continue
      }
    }
  }
  throw lastError ?? new Error(`Request failed after ${attempts} attempts`)
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
