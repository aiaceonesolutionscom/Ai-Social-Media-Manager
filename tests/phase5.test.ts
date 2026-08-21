import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import './setupMocks.js'
import Fastify from 'fastify'
import bcrypt from 'bcrypt'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { initStore, resetStore, countWebhookEvents, listNotifications, getConfig, setConfig, getAllConfig, createAdminUser, getAdminUserByEmail } from '../src/store.js'
import { verifyGatewayWebhook } from '../src/lib/gateway.js'
import { getDb } from '../src/db.js'
import { adminConfig } from '../src/db/schema.js'
import { eq } from 'drizzle-orm'
import { config, assertProductionSecurityConfig } from '../src/config.js'
import { adminAuthMiddleware } from '../src/routes/admin-api/middleware.js'
import { registerAdminAIProviderRoutes } from '../src/routes/admin-api/ai-providers.js'
import { adminLogin, allPermissionKeys } from '../src/lib/adminAuth.js'
import { activatePackage, pausePackage, resumePackage } from '../src/lib/packageLifecycle.js'
import { getUserFeatures, requireFeature } from '../src/lib/packagePermissions.js'
import { notifyPostPublished, notifyPostFailed } from '../src/lib/notifications.js'
import { staticReply } from '../src/lib/language.js'
import { sendText } from '../src/lib/whatsapp.js'
import { handleWebhook } from '../src/routes/webhook.js'
import { PHONE, registerTestUser, makeButtonPayload } from './helpers.js'

describe('P5-1 — package pause/unpause', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('pause locks features and resume restores them', async () => {
    await activatePackage(PHONE, 'pro', { description: 'test' })
    expect((await getUserFeatures(PHONE)).facebook_publishing).toBe(true)

    const paused = await pausePackage(PHONE)
    expect(paused.packageStatus).toBe('paused')
    expect(Object.keys(await getUserFeatures(PHONE))).toHaveLength(0)
    await expect(requireFeature(PHONE, 'facebook_publishing')).rejects.toThrow('not included')

    const resumed = await resumePackage(PHONE)
    expect(resumed.packageStatus).toBe('active')
    expect((await getUserFeatures(PHONE)).facebook_publishing).toBe(true)
  })

  it('cannot pause without an active package or resume a non-paused one', async () => {
    await expect(pausePackage(PHONE)).rejects.toThrow('Only an active package')
    await expect(resumePackage(PHONE)).rejects.toThrow('Only a paused package')
  })
})

describe('P5-2 — dead code wired or removed', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('notifyPostPublished saves an in-app notification AND sends the WhatsApp confirmation', async () => {
    await notifyPostPublished(PHONE, 'media-1', 'https://www.instagram.com/p/ABC/')
    expect(sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('Post Published'))
    const notifs = await listNotifications({ targetType: 'user', targetPhone: PHONE })
    expect(notifs.some((n) => n.category === 'post' && n.title === 'Post Published')).toBe(true)
  })

  it('notifyPostFailed saves a notification', async () => {
    await notifyPostFailed(PHONE, 'IG 500')
    const notifs = await listNotifications({ targetType: 'user', targetPhone: PHONE })
    expect(notifs.some((n) => n.category === 'post' && n.title === 'Post Failed')).toBe(true)
  })

  it('removed greetingRoman key — staticReply no longer exposes it', async () => {
    expect(staticReply('greeting' as never, 'ur')).toContain('آپ')
    const keys = Object.keys((await import('../src/lib/language.js')).STATIC_REPLIES)
    expect(keys).not.toContain('greetingRoman')
    expect(keys).toContain('greeting')
  })

  it('webhook_events receives a row for every delivered webhook', async () => {
    const before = await countWebhookEvents()
    await handleWebhook(makeButtonPayload('cancel', 'wamid.p5.cancel'))
    expect(sendText).toHaveBeenCalledWith(PHONE, expect.stringContaining('No publishing'))
    expect(await countWebhookEvents()).toBe(before + 1)
  })
})

describe('P5-3 — admin_config secrets encrypted at rest', () => {
  beforeAll(() => initStore())
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await registerTestUser()
  })

  it('sensitive keys are encrypted on disk and decrypted transparently on read', async () => {
    await setConfig('gateway_api_key', 'sk_live_topsecret123')
    await setConfig('gateway_webhook_secret', 'whsec_abcdef')
    await setConfig('default_package', 'pro')

    const row = await getDb().select().from(adminConfig).where(eq(adminConfig.key, 'gateway_api_key'))
    expect(row[0].value).not.toContain('topsecret')
    expect(row[0].value).toMatch(/^enc:v1:/)
    expect(row[0].isSensitive).toBe(true)

    expect(await getConfig('gateway_api_key')).toBe('sk_live_topsecret123')
    expect(await getConfig('gateway_webhook_secret')).toBe('whsec_abcdef')
    const all = await getAllConfig()
    expect(all.gateway_api_key).toBe('sk_live_topsecret123')
    expect(all.default_package).toBe('pro')
  })

  it('otp records are encrypted at rest and still usable through getConfig', async () => {
    const record = JSON.stringify({ code: '123456', expiresAt: Date.now() + 60000, attempts: 0 })
    await setConfig('otp:919999999999', record)
    const row = await getDb().select().from(adminConfig).where(eq(adminConfig.key, 'otp:919999999999'))
    expect(row[0].value).not.toContain('123456')
    expect(row[0].isSensitive).toBe(true)
    expect(await getConfig('otp:919999999999')).toBe(record)
  })

  it('non-sensitive config stays plaintext', async () => {
    await setConfig('payment_local_pkr_rate', '300')
    const row = await getDb().select().from(adminConfig).where(eq(adminConfig.key, 'payment_local_pkr_rate'))
    expect(row[0].value).toBe('300')
    expect(row[0].isSensitive).toBe(false)
  })
})

describe('P5-4 — AI provider skipValidation blocked in production', () => {
  const ADMIN_EMAIL = 'p5admin@example.com'
  const ADMIN_PASSWORD = 'p5-admin-secret'
  let app: ReturnType<typeof Fastify>

  beforeAll(async () => {
    await initStore()
    if (!(await getAdminUserByEmail(ADMIN_EMAIL))) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4)
      await createAdminUser({ email: ADMIN_EMAIL, name: 'Admin', passwordHash, role: 'super_admin' })
    }
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    if (app) await app.close()
    app = Fastify()
    app.addHook('preHandler', adminAuthMiddleware)
    await registerAdminAIProviderRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    config.dev.enabled = true
    if (app) await app.close()
  })

  it('rejects skipValidation when DEV_MODE is off, allows it in dev', async () => {
    const login = await adminLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    expect(login.success).toBe(true)
    const headers = { authorization: `Bearer ${login.token}` }
    const payload = { category: 'llm', provider: 'p5-test-llm', displayName: 'P5 Test', apiKey: 'sk-test', skipValidation: true }

    config.dev.enabled = false
    const blocked = await app.inject({ method: 'POST', url: '/api/admin/ai-providers', headers, payload })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toContain('skipValidation is disabled in production')

    config.dev.enabled = true
    const allowed = await app.inject({ method: 'POST', url: '/api/admin/ai-providers', headers, payload })
    expect(allowed.statusCode).toBe(201)
  })
})

describe('P5-6 — permission catalog completeness', () => {
  it('catalog includes every permission key actually used by route guards', () => {
    const keys = allPermissionKeys()
    for (const k of ['admins.view', 'admins.create', 'admins.update', 'admins.delete', 'logs.view']) {
      expect(keys).toContain(k)
    }
    expect(keys.length).toBe(26)
  })
})

describe('P5-7 — gateway webhook replay protection', () => {
  const SECRET = 'whsec_p5test'
  const body = JSON.stringify({ eventType: 'transaction.completed', merchantTransactionId: 'm1', amount: 29000, currency: 'PKR' })

  function newSchemeSig(ts: string, payload: string): string {
    return crypto.createHmac('sha256', SECRET).update(`${ts}.${payload}`).digest('hex').toUpperCase()
  }

  it('accepts a fresh timestamped signature', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    expect(verifyGatewayWebhook({ rawBody: body, timestamp: ts, signature: newSchemeSig(ts, body), webhookSecret: SECRET })).toBe(true)
  })

  it('rejects the legacy raw-body-only signature (replayable)', () => {
    const legacy = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    expect(verifyGatewayWebhook({ rawBody: body, signature: legacy, webhookSecret: SECRET })).toBe(false)
  })

  it('rejects missing, expired, and far-future timestamps', () => {
    const now = Math.floor(Date.now() / 1000)
    for (const ts of [undefined, 'not-a-number', String(now - 301), String(now + 301)]) {
      expect(verifyGatewayWebhook({ rawBody: body, timestamp: ts, signature: newSchemeSig(ts ?? '0', body), webhookSecret: SECRET })).toBe(false)
    }
  })

  it('rejects a tampered body with a valid timestamp', () => {
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = newSchemeSig(ts, body)
    expect(verifyGatewayWebhook({ rawBody: body.replace('29000', '29001'), timestamp: ts, signature: sig, webhookSecret: SECRET })).toBe(false)
  })
})

describe('P5-8 / P5-9 — production startup guards', () => {
  const saved = {
    dev: config.dev.enabled,
    adminEmail: config.admin.email,
    adminPassword: config.admin.password,
    verifyToken: config.whatsapp.verifyToken,
    envAdminEmail: process.env.ADMIN_EMAIL,
    envAdminPassword: process.env.ADMIN_PASSWORD,
    envMaster: process.env.MASTER_ENCRYPTION_KEY,
    envVerify: process.env.WHATSAPP_VERIFY_TOKEN,
  }

  afterAll(() => {
    config.dev.enabled = saved.dev
    config.admin.email = saved.adminEmail
    config.admin.password = saved.adminPassword
    config.whatsapp.verifyToken = saved.verifyToken
    if (saved.envAdminEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = saved.envAdminEmail
    if (saved.envAdminPassword === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = saved.envAdminPassword
    if (saved.envMaster === undefined) delete process.env.MASTER_ENCRYPTION_KEY
    else process.env.MASTER_ENCRYPTION_KEY = saved.envMaster
    if (saved.envVerify === undefined) delete process.env.WHATSAPP_VERIFY_TOKEN
    else process.env.WHATSAPP_VERIFY_TOKEN = saved.envVerify
  })

  it('refuses default admin credentials in production', () => {
    delete process.env.ADMIN_EMAIL
    delete process.env.ADMIN_PASSWORD
    process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-12345678'
    config.dev.enabled = false
    config.admin.email = 'admin@example.com'
    config.admin.password = 'admin123'
    expect(() => assertProductionSecurityConfig()).toThrow('default admin credentials')
  })

  it('refuses the change-me-verify-token placeholder in production', () => {
    process.env.ADMIN_EMAIL = 'real-admin@example.com'
    process.env.ADMIN_PASSWORD = 'a-very-strong-password'
    process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-12345678'
    config.dev.enabled = false
    config.admin.email = 'real-admin@example.com'
    config.admin.password = 'a-very-strong-password'
    config.whatsapp.verifyToken = 'change-me-verify-token'
    expect(() => assertProductionSecurityConfig()).toThrow('change-me-verify-token')
  })

  it('passes when production has strong admin credentials and a real verify token', () => {
    process.env.ADMIN_EMAIL = 'real-admin@example.com'
    process.env.ADMIN_PASSWORD = 'a-very-strong-password'
    process.env.MASTER_ENCRYPTION_KEY = 'test-master-key-12345678'
    process.env.WHATSAPP_VERIFY_TOKEN = 'a-unique-verify-token-xyz'
    config.dev.enabled = false
    config.admin.email = 'real-admin@example.com'
    config.admin.password = 'a-very-strong-password'
    config.whatsapp.verifyToken = 'a-unique-verify-token-xyz'
    expect(() => assertProductionSecurityConfig()).not.toThrow()
  })
})