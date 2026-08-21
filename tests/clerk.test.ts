import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import './setupMocks.js'
import Fastify from 'fastify'
import { initStore, resetStore, getUserByEmail } from '../src/store.js'
import { registerAuthRoutes } from '../src/routes/auth.js'
import { config } from '../src/config.js'

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async () => ({ sub: 'user_123' })),
  createClerkClient: vi.fn(() => ({
    users: {
      getUser: vi.fn(async () => ({
        firstName: 'Clerk',
        lastName: 'User',
        imageUrl: 'https://img.clerk.test/avatar.png',
        emailAddresses: [{ emailAddress: 'clerk-user@example.com' }],
      })),
    },
  })),
}))

const { verifyToken } = await import('@clerk/backend')
const { createClerkClient } = await import('@clerk/backend')

describe('Clerk auth bridge (API wiring)', () => {
  let app: ReturnType<typeof Fastify>
  const saved = { secret: config.clerk.secretKey, publishable: config.clerk.publishableKey }

  beforeAll(async () => {
    await initStore()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    config.clerk.secretKey = 'sk_test_clerkbridge'
    config.clerk.publishableKey = 'pk_test_ZWxlZ2FudC1jb3lvdGUtNzQuY2xlcmsuYWNjb3VudHMuZGV2JA'
    if (app) await app.close()
    app = Fastify()
    await registerAuthRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    config.clerk.secretKey = saved.secret
    config.clerk.publishableKey = saved.publishable
    if (app) await app.close()
  })

  it('POST /api/auth/clerk exchanges a Clerk session token for an app token and creates the user', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/clerk', payload: { token: 'jwt.token.here' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.phone).toBe('clk_user_123')
    expect(body.email).toBe('clerk-user@example.com')
    expect(verifyToken).toHaveBeenCalled()
    expect(createClerkClient).toHaveBeenCalledWith({ secretKey: 'sk_test_clerkbridge' })

    const user = await getUserByEmail('clerk-user@example.com')
    expect(user).toBeTruthy()
    expect(user!.oauthProvider).toBe('clerk')
    expect(user!.oauthId).toBe('user_123')
  })

  it('logs an existing Clerk user back in without creating a duplicate', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/clerk', payload: { token: 'jwt.token.here' } })
    const res = await app.inject({ method: 'POST', url: '/api/auth/clerk', payload: { token: 'jwt.token.here' } })
    expect(res.statusCode).toBe(200)
    const users = await getUserByEmail('clerk-user@example.com')
    expect(users!.oauthId).toBe('user_123')
  })

  it('rejects a request with no token or an unverifiable token', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/auth/clerk', payload: {} })
    expect(missing.statusCode).toBe(400)

    vi.mocked(verifyToken).mockRejectedValueOnce(new Error('jwt expired'))
    const invalid = await app.inject({ method: 'POST', url: '/api/auth/clerk', payload: { token: 'bad.token' } })
    expect(invalid.statusCode).toBe(401)
  })
})