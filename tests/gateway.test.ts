import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import './setupMocks.js'
import Fastify from 'fastify'
import { initStore, resetStore, createUser, createAdminUser, createPackage, getPackage, getUser, getConfig, setConfig, listPayments } from '../src/store.js'
import { registerCheckoutRoutes } from '../src/routes/checkout.js'
import { registerGatewayRoutes } from '../src/routes/gateway.js'
import { registerAdminPaymentRoutes } from '../src/routes/admin-api/payments.js'
import { adminAuthMiddleware } from '../src/routes/admin-api/middleware.js'
import { adminLogin } from '../src/lib/adminAuth.js'
import { config } from '../src/config.js'
import { PHONE } from './helpers.js'

const mocks = vi.hoisted(() => ({ phone: '919999999999' }))

vi.mock('../src/lib/userAuth.js', () => ({
  verifySession: vi.fn().mockResolvedValue({ phone: mocks.phone }),
}))

const GATEWAY_API_KEY = 'sk_test_secret123'
const GATEWAY_WEBHOOK_SECRET = 'whsec_test_secret456'

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

function signWebhook(payload: string, timestamp: string): string {
  return crypto.createHmac('sha256', GATEWAY_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex').toUpperCase()
}

function completedEvent(merchantTransactionId: string, amount = 4437): string {
  // 4437 PKR = 15 USD * 290 rate, +2% MDR (87) — the exact amount /api/checkout sends
  // for the Starter package. The webhook handler verifies this against the payment.
  return JSON.stringify({
    eventId: 'evt_test_1',
    eventType: 'transaction.completed',
    merchantTransactionId,
    gatewayTxnRef: 'gtxn_abc123',
    status: 'SUCCESS',
    amount,
    currency: 'PKR',
  })
}

function failedEvent(merchantTransactionId: string): string {
  return JSON.stringify({
    eventId: 'evt_test_2',
    eventType: 'transaction.failed',
    merchantTransactionId,
    status: 'FAILED',
    amount: 43.5,
    currency: 'PKR',
  })
}

describe('payment gateway (RapidGateway) flow', () => {
  let app: ReturnType<typeof Fastify>
  let adminToken = ''
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    await initStore()
    const { getAdminUserByEmail } = await import('../src/store.js')
    if (!(await getAdminUserByEmail(ADMIN_EMAIL))) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4)
      await createAdminUser({ email: ADMIN_EMAIL, name: 'Admin', passwordHash, role: 'super_admin' })
    }
  })

  beforeEach(async () => {
    config.dev.enabled = false
    config.stripe.secretKey = ''
    await resetStore()
    await seedStarterPackage()
    await setConfig('gateway_enabled', 'on')
    await setConfig('gateway_api_key', GATEWAY_API_KEY)
    await setConfig('gateway_webhook_secret', GATEWAY_WEBHOOK_SECRET)
    await setConfig('payment_local_pkr_rate', '290')
    await setConfig('payment_method_local', 'off')
    await setConfig('payment_method_stripe', 'off')

    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'rg_pay_123', checkout_url: 'https://pay.example/checkout/abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    if (app) await app.close()
    app = Fastify()
    app.addHook('preHandler', adminAuthMiddleware)
    await registerCheckoutRoutes(app)
    await registerGatewayRoutes(app)
    await registerAdminPaymentRoutes(app)
    await app.ready()
    await createUser({ phone: PHONE, name: 'Test User', email: 'test@example.com', tokensRemaining: 0 })

    const login = await adminLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    if (!login.success || !login.token) throw new Error('admin login failed in test setup')
    adminToken = login.token
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('creates a gateway checkout and returns the hosted URL', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.gateway).toBe(true)
    expect(body.url).toBe('https://pay.example/checkout/abc')

    const payments = await listPayments(PHONE)
    expect(payments).toHaveLength(1)
    expect(payments[0].status).toBe('pending')
    expect(payments[0].stripeSessionId.startsWith('rg_')).toBe(true)
    expect(payments[0].taxPercent).toBe(0)
    expect(payments[0].mdrPercent).toBe(2)
    expect(payments[0].taxAmount).toBe(0) // gateway ignores estimated tax
    expect(payments[0].mdrAmount).toBe(87) // 4437 total − 4350 base PKR

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')

    const call = fetchMock.mock.calls[0]
    expect(call[1].headers['Idempotency-Key']).toBe(payments[0].id)
    const sent = JSON.parse(call[1].body)
    expect(sent.amount).toBe(4437)
    expect(sent.currency).toBe('PKR')
    expect(sent.methods).toContain('jazzcash')
    expect(sent.webhook_url).toContain('/webhooks/gateway')
  })

  it('returns 503 when the gateway is not configured', async () => {
    await setConfig('gateway_api_key', '')
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toContain('not configured')
  })

  it('rejects gateway checkout when the toggle is off', async () => {
    await setConfig('gateway_enabled', 'off')
    const res = await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('not enabled')
  })

  it('activates the package when the webhook reports transaction.completed', async () => {
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const payments = await listPayments(PHONE)
    const paymentId = payments[0].id
    const payload = completedEvent(paymentId)
    const ts = String(Math.floor(Date.now() / 1000))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gateway',
      headers: { 'x-rapidgateway-signature': signWebhook(payload, ts), 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().received).toBe(true)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).toBe('active')
    expect(user!.tokensRemaining).toBe(100)
    expect(user!.packageId).toBe('starter')

    const updated = await listPayments(PHONE)
    expect(updated[0].status).toBe('completed')
  })

  it('rejects a webhook whose amount does not match the recorded payment', async () => {
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const paymentId = (await listPayments(PHONE))[0].id
    const payload = completedEvent(paymentId, 1)
    const ts = String(Math.floor(Date.now() / 1000))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gateway',
      headers: { 'x-rapidgateway-signature': signWebhook(payload, ts), 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(400)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')
    expect((await listPayments(PHONE))[0].status).not.toBe('completed')
  })

  it('marks the payment failed and does not activate on transaction.failed', async () => {
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const paymentId = (await listPayments(PHONE))[0].id
    const payload = failedEvent(paymentId)
    const ts = String(Math.floor(Date.now() / 1000))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gateway',
      headers: { 'x-rapidgateway-signature': signWebhook(payload, ts), 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(200)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')
    expect((await listPayments(PHONE))[0].status).toBe('failed')
  })

  it('rejects a webhook with an invalid signature', async () => {
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const paymentId = (await listPayments(PHONE))[0].id
    const payload = completedEvent(paymentId)
    const ts = String(Math.floor(Date.now() / 1000))

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gateway',
      headers: { 'x-rapidgateway-signature': 'deadbeef', 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(401)

    const user = await getUser(PHONE)
    expect(user!.packageStatus).not.toBe('active')
    expect((await listPayments(PHONE))[0].status).toBe('pending')
  })

  it('ignores duplicate webhook deliveries (idempotent)', async () => {
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const paymentId = (await listPayments(PHONE))[0].id
    const payload = completedEvent(paymentId)
    const ts = String(Math.floor(Date.now() / 1000))
    const headers = { 'x-rapidgateway-signature': signWebhook(payload, ts), 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' }

    const first = await app.inject({ method: 'POST', url: '/webhooks/gateway', headers, payload })
    expect(first.statusCode).toBe(200)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)

    const second = await app.inject({ method: 'POST', url: '/webhooks/gateway', headers, payload })
    expect(second.statusCode).toBe(200)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)
    expect((await listPayments(PHONE))[0].status).toBe('completed')
  })

  it('returns 200 (acknowledged) for an unknown payment without activating anything', async () => {
    const payload = completedEvent('no-such-payment-id')
    const ts = String(Math.floor(Date.now() / 1000))
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/gateway',
      headers: { 'x-rapidgateway-signature': signWebhook(payload, ts), 'x-rapidgateway-timestamp': ts, 'content-type': 'application/json' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().received).toBe(true)
  })

  it('applies gateway MDR but ignores the admin tax percent for gateway', async () => {
    await setConfig('checkout_tax_percent', '8')
    await setConfig('checkout_mdr_percent', '2')
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const call = fetchMock.mock.calls[0]
    const sent = JSON.parse(call[1].body)
    // base = 15 USD * 290 = 4350 PKR (no tax for gateway); +2% MDR => 4437
    expect(sent.amount).toBe(4437)
    const payment = (await listPayments(PHONE))[0]
    expect(payment.taxAmount).toBe(0)
    expect(payment.mdrAmount).toBe(87)
  })

  it('charges the base amount when gateway MDR is set to zero', async () => {
    await setConfig('checkout_tax_percent', '8')
    await setConfig('checkout_mdr_percent', '0')
    await app.inject({ method: 'POST', url: '/api/checkout', headers: { authorization: 'Bearer test' }, payload: { packageId: 'starter', method: 'gateway' } })
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    // 15 USD * 290 = 4350, no tax, no MDR
    expect(sent.amount).toBe(4350)
    const payment = (await listPayments(PHONE))[0]
    expect(payment.mdrAmount).toBe(0)
    expect(payment.taxAmount).toBe(0)
    expect(payment.mdrPercent).toBe(0)
  })

  it('super admin can save and read gateway settings (secrets masked)', async () => {
    const save = await app.inject({
      method: 'PUT',
      url: '/api/admin/payments/methods',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { gateway: 'on', gatewaySandbox: true, gatewayApiBase: 'https://api.rapidgateway.pk', gatewayApiKey: 'sk_live_xyz', gatewayWebhookSecret: 'whsec_xyz', pkrRate: 290, taxPercent: 8, mdrPercent: 2 },
    })
    expect(save.statusCode).toBe(200)
    expect(save.json().success).toBe(true)

    expect(await getConfig('gateway_api_key')).toBe('sk_live_xyz')
    expect(await getConfig('gateway_webhook_secret')).toBe('whsec_xyz')
    expect(await getConfig('checkout_tax_percent')).toBe('8')
    expect(await getConfig('checkout_mdr_percent')).toBe('2')

    const read = await app.inject({ method: 'GET', url: '/api/admin/payments/methods', headers: { authorization: `Bearer ${adminToken}` } })
    const body = read.json()
    expect(body.gateway).toBe(true)
    expect(body.gatewaySandbox).toBe(true)
    expect(body.gatewayApiKeySet).toBe(true)
    expect(body.gatewayWebhookSecretSet).toBe(true)
    expect(body.taxPercent).toBe(8)
    expect(body.mdrPercent).toBe(2)
    expect(JSON.stringify(body)).not.toContain('sk_live_xyz')
    expect(JSON.stringify(body)).not.toContain('whsec_xyz')
  })
})
