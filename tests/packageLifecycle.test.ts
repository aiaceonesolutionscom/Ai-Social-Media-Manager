import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import './setupMocks.js'
import { initStore, resetStore, createUser, createPackage, getPackage, getUser, updateUser, getTransactions, createPost, listPosts, recoverStuckPosts, updatePost } from '../src/store.js'
import { activatePackage, endPackage, expirePackage, isPackageExpired, computeExpiry } from '../src/lib/packageLifecycle.js'
import { getUserFeatures, clearFeatureCache } from '../src/lib/packagePermissions.js'
import { PHONE } from './helpers.js'

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
      features: {
        facebook_publishing: true,
        instagram_publishing: true,
        whatsapp_broadcast: true,
        web_chat: true,
        voice_transcription: true,
        scheduled_publishing: true,
        analytics_dashboard: true,
        priority_support: true,
        ad_campaigns: true,
      },
    })
  }
}

async function createUserWithTokens(tokens: number): Promise<void> {
  await createUser({ phone: PHONE, name: 'Test User', email: 'test@example.com', tokensRemaining: tokens })
}

describe('package lifecycle — purchase replaces, expiry locks, end forfeits', () => {
  beforeAll(() => initStore())

  beforeEach(async () => {
    vi.clearAllMocks()
    await resetStore()
    await seedProPackage()
    clearFeatureCache(PHONE)
  })

  it('activatePackage replaces remaining tokens instead of adding', async () => {
    await createUserWithTokens(500)
    const user = await activatePackage(PHONE, 'pro', { description: 'first purchase' })
    expect(user.packageStatus).toBe('active')
    expect(user.packageId).toBe('pro')
    expect(user.packageExpiresAt).toBeDefined()
    // tokens REPLACED to package's includedTokens, not 500 + 1000
    expect(user.tokensRemaining).toBe(1000)

    const txs = await getTransactions(PHONE)
    expect(txs).toHaveLength(1)
    expect(txs[0].type).toBe('grant')
    expect(txs[0].amount).toBe(1000)
    expect(txs[0].balanceAfter).toBe(1000)
  })

  it('activatePackage again overwrites the old package and resets tokens', async () => {
    await createUserWithTokens(0)
    await activatePackage(PHONE, 'pro', { description: 'first' })
    await updateUser(PHONE, { tokensRemaining: 10 })

    // simulate an admin re-granting the package (replace semantics)
    const user = await activatePackage(PHONE, 'pro', { description: 're-purchase', actor: 'admin@test.com' })
    expect(user.tokensRemaining).toBe(1000)

    const txs = await getTransactions(PHONE)
    expect(txs).toHaveLength(2)
    expect(txs.map((t) => t.type)).toEqual(['grant', 'grant'])
  })

  it('endPackage marks status ended, zeroes tokens and records a revoke transaction', async () => {
    await createUserWithTokens(0)
    await activatePackage(PHONE, 'pro')
    await updateUser(PHONE, { tokensRemaining: 300 })

    const user = await endPackage(PHONE, { reason: 'testing' })
    expect(user.packageStatus).toBe('ended')
    expect(user.packageEndedAt).toBeDefined()
    expect(user.tokensRemaining).toBe(0)

    const txs = await getTransactions(PHONE)
    const revoke = txs.find((t) => t.type === 'revoke')
    expect(revoke).toBeDefined()
    expect(revoke!.amount).toBe(300)
    expect(revoke!.balanceAfter).toBe(0)
  })

  it('isPackageExpired locks features via getUserFeatures', async () => {
    await createUserWithTokens(0)
    await activatePackage(PHONE, 'pro')
    expect(await getUserFeatures(PHONE)).toMatchObject({ instagram_publishing: true })

    // force-expire the package in DB
    await updateUser(PHONE, { packageStatus: 'expired', packageExpiresAt: new Date(Date.now() - 1000).toISOString() })
    clearFeatureCache(PHONE)
    const features = await getUserFeatures(PHONE)
    expect(features).toEqual({})
  })

  it('expirePackage only acts on active packages and records system audit', async () => {
    await createUserWithTokens(0)
    await activatePackage(PHONE, 'pro')
    await updateUser(PHONE, { tokensRemaining: 42 })

    const user = await expirePackage(PHONE)
    expect(user).not.toBeNull()
    expect(user!.packageStatus).toBe('expired')
    expect(user!.tokensRemaining).toBe(0)

    const txs = await getTransactions(PHONE)
    const revoke = txs.find((t) => t.type === 'revoke')
    expect(revoke).toBeDefined()
    expect(revoke!.amount).toBe(42)

    // already expired/ended → no-op
    const again = await expirePackage(PHONE)
    expect(again).toBeNull()
  })

  it('computeExpiry produces a future date in the future', () => {
    const monthly = computeExpiry('monthly')
    const yearly = computeExpiry('yearly')
    expect(new Date(monthly).getTime()).toBeGreaterThan(Date.now())
    expect(new Date(yearly).getTime()).toBeGreaterThan(new Date(monthly).getTime())
  })

  it('recoverStuckPosts refunds a charged stuck post before resetting it (no double charge)', async () => {
    await createUserWithTokens(0)
    await activatePackage(PHONE, 'pro')
    // simulate a cross-platform charge already applied
    await updateUser(PHONE, { tokensRemaining: 998 })

    const post = await createPost(PHONE)
    await updatePost(post.id, {
      status: 'PREPARING_TO_PUBLISH',
      tokensCharged: 2,
      tokensChargedAction: 'cross_platform',
    })

    const recovered = await recoverStuckPosts()
    expect(recovered).toBe(1)

    const posts = await listPosts()
    expect(posts[0].status).toBe('AWAITING_APPROVAL')
    expect(posts[0].tokensCharged).toBe(0)
    expect(posts[0].tokensChargedAction).toBeUndefined()

    const user = await getUser(PHONE)
    // 998 (simulated post-charge balance) + 2 (refund) = 1000
    expect(user!.tokensRemaining).toBe(1000)

    const txs = await getTransactions(PHONE)
    const refund = txs.find((t) => t.type === 'refund')
    expect(refund).toBeDefined()
    expect(refund!.amount).toBe(2)
  })

  it('backfill migration marks legacy package owners as active with a billing-period expiry', async () => {
    // simulate a user that bought a package before the lifecycle feature existed
    await createUser({ phone: PHONE, name: 'Legacy', email: 'legacy@test.com', packageId: 'pro', tokensRemaining: 500 })
    let user = await getUser(PHONE)
    expect(user!.packageStatus).toBe('none')
    expect(user!.packageExpiresAt).toBe('')

    // initStore re-runs the idempotent backfill migration
    await initStore()
    user = await getUser(PHONE)
    expect(user!.packageStatus).toBe('active')
    expect(user!.packageStartedAt).not.toBe('')
    const expires = new Date(user!.packageExpiresAt).getTime()
    expect(expires).toBeGreaterThan(Date.now())
    // pro is monthly → ~31 days from now
    const days = (expires - Date.now()) / (24 * 60 * 60 * 1000)
    expect(days).toBeGreaterThan(20)
    expect(days).toBeLessThan(40)

    // a user with no package stays untouched
    await createUser({ phone: '919999999998', name: 'Free', email: 'free@test.com', tokensRemaining: 0 })
    await initStore()
    const free = await getUser('919999999998')
    expect(free!.packageStatus).toBe('none')
  })
})
