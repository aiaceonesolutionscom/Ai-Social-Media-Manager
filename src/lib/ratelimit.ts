const hits = new Map<string, number[]>()

export interface RateLimitOpts {
  windowMs?: number
  max?: number
}

export function rateLimit(phone: string, opts: RateLimitOpts = {}): { allowed: boolean; remaining: number } {
  const windowMs = opts.windowMs ?? 10 * 60 * 1000
  const max = opts.max ?? 30
  const now = Date.now()
  const timestamps = hits.get(phone) ?? []
  const windowStart = now - windowMs
  const recent = timestamps.filter((t) => t > windowStart)
  hits.set(phone, recent)
  if (recent.length >= max) {
    return { allowed: false, remaining: 0 }
  }
  recent.push(now)
  return { allowed: true, remaining: max - recent.length }
}

export function resetRateLimit(phone?: string): void {
  if (phone) {
    hits.delete(phone)
  } else {
    hits.clear()
  }
}
