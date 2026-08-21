import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const query = vi.fn()
  return { query }
})

vi.mock('../src/db.js', () => ({
  getPool: () => ({ query: mocks.query }),
  getDb: () => ({}),
  closeDb: vi.fn(),
}))

import { resetStore } from '../src/store.js'
import { config, assertProductionSecurityConfig } from '../src/config.js'

describe('resetStore test-database guard', () => {
  beforeEach(() => {
    mocks.query.mockReset()
  })

  it('throws and issues no DELETEs when the current database is not a _test database', async () => {
    mocks.query.mockResolvedValue({ rows: [{ db: 'ai_instagram' }] })
    await expect(resetStore()).rejects.toThrow(/Refusing to wipe non-test data/)
    // Only the guard SELECT ran; no DELETE statements were issued.
    expect(mocks.query).toHaveBeenCalledTimes(1)
  })

  it('proceeds to wipe when the current database is a _test database', async () => {
    mocks.query.mockResolvedValue({ rows: [{ db: 'ai_instagram_test' }] })
    await resetStore()
    expect(mocks.query.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('assertProductionSecurityConfig', () => {
  const originalDev = config.dev.enabled
  const originalAdminEmail = config.admin.email
  const originalAdminPassword = config.admin.password
  const originalVerifyToken = config.whatsapp.verifyToken

  afterEach(() => {
    config.dev.enabled = originalDev
    config.admin.email = originalAdminEmail
    config.admin.password = originalAdminPassword
    config.whatsapp.verifyToken = originalVerifyToken
    vi.unstubAllEnvs()
  })

  it('throws when DEV_MODE is off and MASTER_ENCRYPTION_KEY is missing', () => {
    config.dev.enabled = false
    vi.stubEnv('MASTER_ENCRYPTION_KEY', '')
    expect(() => assertProductionSecurityConfig()).toThrow(/MASTER_ENCRYPTION_KEY is required/)
  })

  it('passes when DEV_MODE is off and MASTER_ENCRYPTION_KEY is set (with real admin creds + verify token)', () => {
    config.dev.enabled = false
    vi.stubEnv('MASTER_ENCRYPTION_KEY', 'test-secret-key-1234567890')
    vi.stubEnv('ADMIN_EMAIL', 'ops@example.com')
    vi.stubEnv('ADMIN_PASSWORD', 'strong-password-123')
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'real-verify-token-xyz')
    config.admin.email = 'ops@example.com'
    config.admin.password = 'strong-password-123'
    config.whatsapp.verifyToken = 'real-verify-token-xyz'
    expect(() => assertProductionSecurityConfig()).not.toThrow()
  })

  it('passes in dev mode even without a master key', () => {
    config.dev.enabled = true
    vi.stubEnv('MASTER_ENCRYPTION_KEY', '')
    expect(() => assertProductionSecurityConfig()).not.toThrow()
  })
})