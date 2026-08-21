import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import Fastify from 'fastify'
import { initStore, resetStore, createPayment, updatePayment, completePayment, isDuplicateDelivery } from '../src/store.js'
import { config } from '../src/config.js'
import { createShortLivedCode, consumeShortLivedCode, resetShortLivedCodes } from '../src/lib/shortCode.js'
import { signMediaUrl, verifyMediaUrl } from '../src/lib/mediaAuth.js'
import { paymentStatusTransitionAllowed } from '../src/lib/paymentTransitions.js'
import { recoverStuckPayments } from '../src/store.js'
import { billingEngine } from '../src/lib/BillingEngine.js'
import { rateLimit, resetRateLimit } from '../src/lib/ratelimit.js'
import { answerQuery, resetAnswerCache } from '../src/lib/AssistantService.js'
import { registerMediaRoute } from '../src/routes/media.js'
import { registerAssistantRoutes } from '../src/routes/assistant.js'
import { registerAuthRoutes } from '../src/routes/auth.js'
import { isValidImageUrl } from '../src/lib/urlAnalyzer.js'
import { setConfig } from '../src/store.js'

vi.mock('../src/lib/http.js', () => ({
  fetchWithRetry: vi.fn(async () => {
    throw new Error('fetchWithRetry should not be called for blocked URLs')
  }),
}))
import { fetchWithRetry } from '../src/lib/http.js'
import { analyzeWebsite } from '../src/lib/urlAnalyzer.js'
const fetchWithRetryMock = vi.mocked(fetchWithRetry)

const PHONE = '+1111111111'

describe('H6 — short-lived auth codes', () => {
  beforeEach(() => resetShortLivedCodes())

  it('round-trips a value and is single-use', () => {
    const code = createShortLivedCode(JSON.stringify({ token: 'abc', phone: PHONE }))
    expect(consumeShortLivedCode(code)).toBe(JSON.stringify({ token: 'abc', phone: PHONE }))
    expect(consumeShortLivedCode(code)).toBeUndefined()
  })

  it('expires after the TTL and cannot be reused', () => {
    const code = createShortLivedCode('x', 1)
    const decoded = consumeShortLivedCode(code)
    expect(decoded).toBe('x')
    expect(consumeShortLivedCode(code)).toBeUndefined()
  })

  it('returns undefined for garbage codes', () => {
    expect(consumeShortLivedCode('not-a-code')).toBeUndefined()
  })
})

describe('H9 — signed media URLs', () => {
  it('verifies a valid signature and rejects tampered or expired ones', () => {
    const base = 'http://localhost:8787/media/photo.png'
    const url = signMediaUrl('photo.png', base, 60_000)
    const parsed = new URL(url)
    const expires = parsed.searchParams.get('expires')
    const sig = parsed.searchParams.get('sig')
    expect(verifyMediaUrl('photo.png', expires, sig)).toBe(true)
    expect(verifyMediaUrl('other.png', expires, sig)).toBe(false)
    expect(verifyMediaUrl('photo.png', String(Number(expires) - 200_000), sig)).toBe(false)
    expect(verifyMediaUrl('photo.png', expires, 'tampered')).toBe(false)
    expect(verifyMediaUrl('photo.png', undefined, undefined)).toBe(false)
  })
})

describe('H8 — webhook message dedup lives in the store and clears on reset', () => {
  beforeAll(async () => initStore())
  beforeEach(async () => {
    await resetStore()
  })

  it('skips the same phone+msgId twice and allows distinct ids', () => {
    expect(isDuplicateDelivery(PHONE, 'wamid.1')).toBe(false)
    expect(isDuplicateDelivery(PHONE, 'wamid.1')).toBe(true)
    expect(isDuplicateDelivery(PHONE, 'wamid.2')).toBe(false)
    // Different phone, same id is not a duplicate.
    expect(isDuplicateDelivery('+2222222222', 'wamid.1')).toBe(false)
  })

  it('forgets ids when the store is reset (fresh test / restart)', async () => {
    isDuplicateDelivery(PHONE, 'wamid.dup')
    expect(isDuplicateDelivery(PHONE, 'wamid.dup')).toBe(true)
    await resetStore()
    expect(isDuplicateDelivery(PHONE, 'wamid.dup')).toBe(false)
  })
})

describe('H10 — admin payment status transitions', () => {
  it('only allows local pending→completed and completed→refunded', () => {
    expect(paymentStatusTransitionAllowed('pending', 'completed', true)).toBe(true)
    expect(paymentStatusTransitionAllowed('completed', 'refunded', true)).toBe(true)
    expect(paymentStatusTransitionAllowed('pending', 'refunded', true)).toBe(false)
    expect(paymentStatusTransitionAllowed('failed', 'completed', true)).toBe(false)
    expect(paymentStatusTransitionAllowed('completed', 'pending', true)).toBe(false)
  })

  it('never allows admin to complete a gateway payment', () => {
    expect(paymentStatusTransitionAllowed('pending', 'completed', false)).toBe(false)
    expect(paymentStatusTransitionAllowed('pending', 'failed', false)).toBe(true)
    expect(paymentStatusTransitionAllowed('completed', 'refunded', false)).toBe(true)
    expect(paymentStatusTransitionAllowed('pending', 'refunded', false)).toBe(false)
    expect(paymentStatusTransitionAllowed('completed', 'failed', false)).toBe(false)
  })
})

describe('H14 — stuck payment recovery', () => {
  beforeAll(async () => initStore())
  beforeEach(async () => {
    await resetStore()
  })

  it('resets stale processing and fails abandoned pending', async () => {
    const { eq } = await import('drizzle-orm')
    const { getDb } = await import('../src/db.js')
    const { payments } = await import('../src/db/schema.js')

    const processing = await createPayment({ phone: PHONE, tokenCount: 100, amountCents: 5000, type: 'one_time', stripeSessionId: 's_processing' })
    const pending = await createPayment({ phone: PHONE, tokenCount: 100, amountCents: 5000, type: 'one_time', stripeSessionId: 's_pending' })
    const fresh = await createPayment({ phone: PHONE, tokenCount: 100, amountCents: 5000, type: 'one_time', stripeSessionId: 's_fresh' })

    // processing stuck for 20 minutes, pending abandoned for 2 days.
    await getDb().update(payments).set({ createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() }).where(eq(payments.id, processing.id))
    await updatePayment(processing.id, { status: 'processing' })
    await getDb().update(payments).set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() }).where(eq(payments.id, pending.id))

    const { reset, failed } = await recoverStuckPayments()
    expect(reset).toBe(1)
    expect(failed).toBe(1)

    const [p1, p2, p3] = await Promise.all([
      import('../src/store.js').then((s) => s.getPayment(processing.id)),
      import('../src/store.js').then((s) => s.getPayment(pending.id)),
      import('../src/store.js').then((s) => s.getPayment(fresh.id)),
    ])
    expect(p1!.status).toBe('pending')
    expect(p2!.status).toBe('failed')
    expect(p3!.status).toBe('pending')
  })
})

describe('H11 + H12 — billing fees are currency-normalized and timestamps parse in UTC', () => {
  beforeAll(async () => initStore())
  beforeEach(async () => {
    await resetStore()
    await setConfig('payment_local_pkr_rate', '280')
  })

  it('sums USD fees directly and converts PKR mdr to USD at the configured rate', async () => {
    const usd = await createPayment({
      phone: PHONE, tokenCount: 100, amountCents: 5000, type: 'one_time',
      taxAmount: 400, mdrAmount: 100, currency: 'USD', stripeSessionId: 's_usd',
    })
    const pkr = await createPayment({
      phone: PHONE, tokenCount: 100, amountCents: 5000, type: 'one_time',
      taxAmount: 0, mdrAmount: 56000, currency: 'PKR', stripeSessionId: 's_pkr',
    })
    await completePayment(usd.id)
    await completePayment(pkr.id)

    const summary = await billingEngine.getSummary()
    expect(summary.totalFees).toBe(500 + 200) // 500 USD fees + 56000/280 = 200
    expect(summary.totalMdr).toBe(100 + 200)
    // Revenue is already stored in USD minor units.
    expect(summary.totalRevenue).toBe(10000)
  })

  it('monthly aggregates work with ISO-8601 timestamps that carry a trailing Z', async () => {
    const p = await createPayment({ phone: PHONE, tokenCount: 100, amountCents: 1234, type: 'one_time', taxAmount: 50, mdrAmount: 25, currency: 'USD', stripeSessionId: 's_iso' })
    await completePayment(p.id)
    const summary = await billingEngine.getSummary()
    expect(summary.monthlyRevenue).toBe(1234)
    expect(summary.monthlyFees).toBe(75)
  })
})

describe('H16 — SSRF protection for the URL analyzer', () => {
  beforeEach(() => {
    resetRateLimit()
    fetchWithRetryMock.mockClear()
  })

  it('does not fetch private/loopback/metadata hosts', async () => {
    for (const bad of [
      'http://127.0.0.1/secret',
      'http://localhost:8080/',
      'http://169.254.169.254/latest/meta-data/',
      'http://192.168.1.1/',
      'http://10.0.0.5/',
    ]) {
      const res = await analyzeWebsite(bad)
      expect(res.businessName).toBe('Unknown Business')
    }
    expect(fetchWithRetryMock).not.toHaveBeenCalled()
  })

  it('rejects literal private image URLs in isValidImageUrl', () => {
    expect(isValidImageUrl('http://192.168.1.1/x.jpg')).toBe(false)
    expect(isValidImageUrl('http://169.254.169.254/meta')).toBe(false)
    expect(isValidImageUrl('http://127.0.0.1/x.jpg')).toBe(false)
    expect(isValidImageUrl('https://example.com/x.jpg')).toBe(false)
    expect(isValidImageUrl('https://i.imgur.com/abc.jpg')).toBe(true)
  })
})

describe('H17 — public assistant rate limit, input cap and cache', () => {
  beforeAll(async () => initStore())
  beforeEach(async () => {
    resetRateLimit()
    resetAnswerCache()
  })

  it('enforces the max per window in the rate limiter', () => {
    for (let i = 0; i < 20; i++) {
      const r = rateLimit('assistant:127.0.0.1', { windowMs: 60_000, max: 20 })
      expect(r.allowed).toBe(true)
    }
    expect(rateLimit('assistant:127.0.0.1', { windowMs: 60_000, max: 20 }).allowed).toBe(false)
  })

  it('rejects oversized queries and rate-limit bursts via the route', async () => {
    const app = Fastify()
    await registerAssistantRoutes(app as any)
    const long = await app.inject({ method: 'POST', url: '/api/public/assistant', payload: { q: 'a'.repeat(600) } })
    expect(long.statusCode).toBe(400)

    for (let i = 0; i < 20; i++) {
      const r = await app.inject({ method: 'GET', url: '/api/public/assistant?q=packages' })
      expect(r.statusCode).toBe(200)
    }
    const blocked = await app.inject({ method: 'GET', url: '/api/public/assistant?q=packages' })
    expect(blocked.statusCode).toBe(429)
    await app.close()
  })

  it('caches repeated identical queries and can be reset', async () => {
    const a = await answerQuery('what packages do you offer')
    const b = await answerQuery('what packages do you offer')
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    resetAnswerCache()
    const c = await answerQuery('what packages do you offer')
    expect(JSON.stringify(c)).toBe(JSON.stringify(a))
  })
})

describe('H9 — /media/:file requires a valid signature or ownership', () => {
  const imagesDir = path.join(config.storageDir, 'images')
  const fileName = 'phase4-sig-test.png'
  let app: any

  beforeAll(async () => {
    fs.mkdirSync(imagesDir, { recursive: true })
    fs.writeFileSync(path.join(imagesDir, fileName), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    app = Fastify()
    registerMediaRoute(app as any)
  })

  afterAll(async () => {
    try {
      fs.unlinkSync(path.join(imagesDir, fileName))
    } catch { /* ignore */ }
    if (app) await app.close()
  })

  it('returns 401 without a signature', async () => {
    const res = await app.inject({ method: 'GET', url: `/media/${fileName}` })
    expect(res.statusCode).toBe(401)
  })

  it('serves the file with a valid short-lived signature', async () => {
    const signed = signMediaUrl(fileName, `http://localhost:8787/media/${fileName}`)
    const parsed = new URL(signed)
    const res = await app.inject({
      method: 'GET',
      url: `/media/${fileName}?expires=${parsed.searchParams.get('expires')}&sig=${parsed.searchParams.get('sig')}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('image/png')
  })

  it('rejects a tampered signature', async () => {
    const signed = signMediaUrl(fileName, `http://localhost:8787/media/${fileName}`)
    const parsed = new URL(signed)
    const res = await app.inject({
      method: 'GET',
      url: `/media/${fileName}?expires=${parsed.searchParams.get('expires')}&sig=deadbeef`,
    })
    expect(res.statusCode).toBe(401)
  })

  it('blocks path traversal (returns 404 before any auth leak)', async () => {
    const res = await app.inject({ method: 'GET', url: '/media/..%2F..%2Fenv' })
    expect(res.statusCode).toBe(404)
  })
})

describe('H6 — auth code exchange route', () => {
  beforeAll(async () => initStore())
  beforeEach(async () => {
    resetShortLivedCodes()
  })

  it('exchanges a valid code once and rejects replay', async () => {
    const app = Fastify()
    await registerAuthRoutes(app as any)
    const code = createShortLivedCode(JSON.stringify({ token: 'tok123', phone: PHONE, isNew: false }))

    const ok = await app.inject({
      method: 'POST', url: '/api/auth/exchange', payload: { code },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().token).toBe('tok123')

    const replay = await app.inject({
      method: 'POST', url: '/api/auth/exchange', payload: { code },
    })
    expect(replay.statusCode).toBe(401)
    await app.close()
  })

  it('rejects a missing code', async () => {
    const app = Fastify()
    await registerAuthRoutes(app as any)
    const res = await app.inject({ method: 'POST', url: '/api/auth/exchange', payload: {} })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})