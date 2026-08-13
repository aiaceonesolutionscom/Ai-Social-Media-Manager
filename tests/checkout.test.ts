import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import Fastify from 'fastify'
import { initStore, resetStore, createUser, createPackage, getPackage, getUser } from '../src/store.js'
import { registerCheckoutRoutes } from '../src/routes/checkout.js'
import { registerAuthRoutes } from '../src/routes/auth.js'
import { activatePackage } from '../src/lib/packageLifecycle.js'
import { config } from '../src/config.js'
import { PHONE } from './helpers.js'

vi.mock('../src/lib/userAuth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/userAuth.js')>()
  return { ...actual, verifySession: vi.fn().mockResolvedValue({ phone: '919999999999' }) }
})

async function seedProPackage(): Promise<void> {
  const existing = await getPackage('pro')
  if (!existing) {
    await createPackage({
      name: 'Pro',
      slug: 'pro',
      description: 'Test package',
      priceCents: 100,
      includedTokens: 1000,
      billingPeriod: 'monthly',
      features: { instagram_publishing: true, facebook_publishing: true },
    })
  }
}

function enableDev() {
  config.dev.enabled = true
  config.stripe.secretKey = ''
}

describe('checkout — active package blocks purchase, replace after end', () => {
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    await initStore()
  })

  beforeEach(async () => {
    enableDev()
    await resetStore()
    await seedProPackage()
    if (app) await app.close()
    app = Fastify()
    await registerAuthRoutes(app)
    await registerCheckoutRoutes(app)
    await app.ready()
    await createUser({ phone: PHONE, name: 'Test User', email: 'test@example.com', tokensRemaining: 0 })
  })

  it('blocks checkout when user already has an active package', async () => {
    await activatePackage(PHONE, 'pro')
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'pro' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('active package')
  })

  it('allows checkout after the package has been ended (replace semantics)', async () => {
    await activatePackage(PHONE, 'pro')
    await app.inject({ method: 'POST', url: '/api/user/package/end', headers: { authorization: 'Bearer test' } })
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'pro' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().granted).toBe(true)
    const user = await getUser(PHONE)
    expect(user!.tokensRemaining).toBe(1000)
    expect(user!.packageStatus).toBe('active')
  })

  it('allows checkout when the previous package has expired', async () => {
    await activatePackage(PHONE, 'pro')
    const { updateUser } = await import('../src/store.js')
    await updateUser(PHONE, { packageStatus: 'expired', packageExpiresAt: new Date(Date.now() - 1000).toISOString() })
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'pro' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().granted).toBe(true)
  })

  it('user end-package endpoint rejects when there is no active package', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/user/package/end', headers: { authorization: 'Bearer test' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('no active package')
  })
})
