import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit, resetRateLimit } from '../src/lib/ratelimit.js'

describe('P5 — rate limiter', () => {
  beforeEach(() => {
    resetRateLimit()
  })

  it('allows requests within the limit', () => {
    const r1 = rateLimit('919999999999', { windowMs: 60_000, max: 5 })
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(4)
  })

  it('blocks requests over the limit', () => {
    const phone = '919999999998'
    for (let i = 0; i < 5; i++) {
      rateLimit(phone, { windowMs: 60_000, max: 5 })
    }
    const blocked = rateLimit(phone, { windowMs: 60_000, max: 5 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
  })

  it('resets after the window expires', async () => {
    const phone = '919999999997'
    for (let i = 0; i < 3; i++) {
      rateLimit(phone, { windowMs: 50, max: 3 })
    }
    const blocked = rateLimit(phone, { windowMs: 50, max: 3 })
    expect(blocked.allowed).toBe(false)

    await new Promise((r) => setTimeout(r, 60))
    const allowed = rateLimit(phone, { windowMs: 50, max: 3 })
    expect(allowed.allowed).toBe(true)
    expect(allowed.remaining).toBe(2)
  })

  it('resetRateLimit clears all entries', () => {
    const phone = '919999999996'
    rateLimit(phone, { windowMs: 60_000, max: 3 })
    rateLimit(phone, { windowMs: 60_000, max: 3 })
    resetRateLimit()
    const r = rateLimit(phone, { windowMs: 60_000, max: 3 })
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(2)
  })
})