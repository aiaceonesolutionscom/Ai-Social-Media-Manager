import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import bcrypt from 'bcrypt'
import './setupMocks.js'
import Fastify from 'fastify'
import { initStore, resetStore, createAdminUser, createUser, getUser } from '../src/store.js'
import { registerAdminUserRoutes } from '../src/routes/admin-api/users.js'
import { adminAuthMiddleware } from '../src/routes/admin-api/middleware.js'
import { adminLogin } from '../src/lib/adminAuth.js'
import { PHONE } from './helpers.js'

const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin-secret-123'

describe('admin user API must not expose password hashes', () => {
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
    await resetStore()
    await createUser({ phone: PHONE, name: 'Test User', email: 'test@example.com', passwordHash: 'bcrypt-hash-not-for-clients', tokensRemaining: 50 })

    if (app) await app.close()
    app = Fastify()
    app.addHook('preHandler', adminAuthMiddleware)
    await registerAdminUserRoutes(app)
    await app.ready()

    const login = await adminLogin(ADMIN_EMAIL, ADMIN_PASSWORD)
    if (!login.success || !login.token) throw new Error('admin login failed in test setup')
    adminToken = login.token
  })

  it('strips passwordHash from the user list', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.statusCode).toBe(200)
    const users = res.json().users as Array<Record<string, unknown>>
    expect(users.length).toBeGreaterThan(0)
    for (const user of users) {
      expect(user.passwordHash).toBeUndefined()
      expect(JSON.stringify(user)).not.toContain('bcrypt-hash-not-for-clients')
    }
  })

  it('strips passwordHash from the single-user response', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/users/${PHONE}`, headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.statusCode).toBe(200)
    const user = res.json().user as Record<string, unknown>
    expect(user.passwordHash).toBeUndefined()
    expect(JSON.stringify(user)).not.toContain('bcrypt-hash-not-for-clients')
  })

  it('keeps the hash in storage (only the response is sanitized)', async () => {
    const stored = await getUser(PHONE)
    expect(stored?.passwordHash).toBe('bcrypt-hash-not-for-clients')
  })
})