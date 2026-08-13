import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import bcrypt from 'bcrypt'
import './setupMocks.js'
import Fastify from 'fastify'
import { initStore, resetStore, createUser, createAdminUser, createPackage, getPackage, getUser, getConfig, setConfig, createPayment, updatePayment } from '../src/store.js'
import { registerCheckoutRoutes } from '../src/routes/checkout.js'
import { registerAdminPaymentRoutes } from '../src/routes/admin-api/payments.js'
import { adminAuthMiddleware } from '../src/routes/admin-api/middleware.js'
import { adminLogin } from '../src/lib/adminAuth.js'
import { config } from '../src/config.js'
import { PHONE } from './helpers.js'

const mocks = vi.hoisted(() => ({ phone: '919999999999' }))

vi.mock('../src/lib/userAuth.js', () => ({
  verifySession: vi.fn().mockResolvedValue({ phone: mocks.phone }),
}))

async function seedStarterPackage(): Promise<void> {
  const existing = await getPackage('starter')
  if (!existing) {
    await createPackage({
      name: 'Starter',
      slug: 'starter',
      description: 'Test package',
      priceCents: 1500,
      includedTokens: 100,
      billingPeriod: 'monthly',
      features: { instagram_publishing: true, facebook_publishing: true },
    })
  }
}

const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin-secret-123'

describe('local payment handling (legacy / removed from checkout)', () => {
  let app: ReturnType<typeof Fastify>
  let adminToken = ''

  beforeAll(async () => {
    await initStore()
    const { getAdminUserByEmail } = await import('../src/store.js')
    if (!(await getAdminUserByEmail(ADMIN_EMAIL))) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4)
      await createAdminUser({ email: ADMIN_EMAIL, name: 'Admin', passwordHash, role: 'super_admin' })
    }
  })

  beforeEach(async () => {
    config.dev.enabled = true
    config.stripe.secretKey = ''
    await resetStore()
    await seedStarterPackage()
    if (app) await app.close()
    app = Fastify()
    app.addHook('preHandler', adminAuthMiddleware)
    await registerCheckoutRoutes(app)
    await registerAdminPaymentRoutes(app)
    await app.ready()
    await createUser({ phone: PHONE, name: 'Test User', email: 'test@example.com', tokensRemaining: 0 })

    // Direct login bypasses the HTTP route rate limiter.
    const login = await adminLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    if (!login.success || !login.token) throw new Error('admin login failed in test setup')
    adminToken = login.token
  })

  it('rejects the removed local method at checkout', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'local', reference: 'JZ123456' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Local payments are no longer available')

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')
    expect(await getConfig(`untrusted_local:${PHONE}`)).toBeUndefined()
  })

  it('lets an admin confirm a legacy pending local_ payment', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'local_legacy_1',
    })

    const confirm = await app.inject({ method: 'PUT', url: `/api/admin/payments/${payment.id}`, headers: { authorization: `Bearer ${adminToken}` }, payload: { status: 'completed' } })
    expect(confirm.json().activated).toBe(true)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).toBe('active')
    expect(user!.tokensRemaining).toBe(100)
  })

  it('revokes a completed local payment, forfeits tokens, and trust-locks the user', async () => {
    const { activatePackage } = await import('../src/lib/packageLifecycle.js')
    await activatePackage(PHONE, 'starter')

    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'local_legacy_2',
    })
    await updatePayment(payment.id, { status: 'completed' })

    const revoke = await app.inject({ method: 'PUT', url: `/api/admin/payments/${payment.id}`, headers: { authorization: `Bearer ${adminToken}` }, payload: { status: 'refunded' } })
    expect(revoke.json().revoked).toBe(true)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')
    expect(user!.tokensRemaining).toBe(0)
    expect(await getConfig(`untrusted_local:${PHONE}`)).toBe('1')
  })

  it('super admin can save payment method settings (local fields ignored)', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/payments/methods', headers: { authorization: `Bearer ${adminToken}` }, payload: { stripe: 'on', local: 'on', auto: 'off', pkrRate: 290, taxPercent: 8, mdrPercent: 2, jazzcash: '03001234567', title: 'Test Agency' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    // local/auto are no longer written by the methods endpoint
    expect(await getConfig('payment_method_local')).toBeUndefined()
    expect(await getConfig('payment_local_auto')).toBeUndefined()
    expect(await getConfig('checkout_tax_percent')).toBe('8')
    expect(await getConfig('checkout_mdr_percent')).toBe('2')

    const read = await app.inject({ method: 'GET', url: '/api/admin/payments/methods', headers: { authorization: `Bearer ${adminToken}` } })
    const body = read.json()
    expect(body.stripe).toBe(true)
    expect(body.local).toBeUndefined()
    expect(body.taxPercent).toBe(8)
    expect(body.mdrPercent).toBe(2)
  })
})
