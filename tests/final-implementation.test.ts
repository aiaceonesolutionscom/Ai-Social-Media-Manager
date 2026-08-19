import { describe, it, expect, beforeEach } from 'vitest'
import './setupMocks.js'
import {
  initStore, resetStore, createUser, createPackage, getUser,
  createPayment, updatePayment, claimPaymentByStripeSession, completePayment,
  logAIUsage, listAICosts, getActivePricingVersion,
  upsertAICostVersion, listAICostVersions, createAIProvider, getAIProvider, updateAIProvider,
  connectAccount,
} from '../src/store.js'
import { tokenEngine } from '../src/lib/TokenEngine.js'
import { billingEngine } from '../src/lib/BillingEngine.js'
import { evaluatePackageProfitability, checkProposedMargin } from '../src/lib/profitability.js'
import { getDb } from '../src/db.js'
import { eq } from 'drizzle-orm'
import { tokenTransactions, aiProviderCostVersions } from '../src/db/schema.js'

const PHONE = '919999999999'

async function registerTestUser(phone: string, tokens = 100): Promise<void> {
  const existing = await getUser(phone)
  if (!existing) {
    await createUser({
      phone,
      name: 'Test User',
      email: `${phone}@test.com`,
      tokensRemaining: tokens,
      packageId: 'starter',
    })
  }
  try {
    await connectAccount({ phone, platform: 'instagram', accountId: 'ig_' + phone, accountName: 'Test IG', accessToken: 'mock-ig-token' })
    await connectAccount({ phone, platform: 'facebook', accountId: 'fb_' + phone, accountName: 'Test FB', accessToken: 'mock-fb-token' })
  } catch {}
}

async function countTxnsByOpId(opId: string): Promise<number> {
  const rows = await getDb().select().from(tokenTransactions).where(eq(tokenTransactions.operationId, opId))
  return rows.length
}

describe('J. Concurrent Webhook Idempotency (exactly-once grant)', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser(PHONE, 0)
  })

  it('10 concurrent grants with the same operationId → exactly one grant', async () => {
    const opId = 'stripe:test_001'
    const results = await Promise.all(
      Array.from({ length: 10 }, () => tokenEngine.grant(PHONE, 50, 'admin', 'webhook grant', opId)),
    )
    const granted = results.filter((r) => r.success && !r.alreadyCharged)
    expect(granted).toHaveLength(1)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(50)
    expect(await countTxnsByOpId(opId)).toBe(1)
  })

  it('10 concurrent deducts with the same operationId → exactly one charge', async () => {
    await tokenEngine.grant(PHONE, 100, 'admin', 'setup')
    const opId = 'post:test_001'
    const results = await Promise.all(
      Array.from({ length: 10 }, () => tokenEngine.deduct('voice_transcription', PHONE, 'concurrent', opId)),
    )
    const charged = results.filter((r) => r.success && !r.alreadyCharged)
    expect(charged).toHaveLength(1)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(99)
    expect(await countTxnsByOpId(opId)).toBe(1)
  })

  it('10 concurrent claimPaymentByStripeSession → exactly one claim', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      stripeSessionId: 'sess_conc_001',
    })
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claimPaymentByStripeSession('sess_conc_001')),
    )
    const claimed = results.filter((r) => r !== undefined)
    expect(claimed).toHaveLength(1)
    await completePayment(claimed[0]!.id)
    expect(await claimPaymentByStripeSession('sess_conc_001')).toBeUndefined()
    expect(payment.id).toBe(claimed[0]!.id)
  })
})

describe('K. Pricing Version Lifecycle', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
  })

  it('upsertAICostVersion always creates a NEW version and closes the old one', async () => {
    const v1 = await getActivePricingVersion('deepseek', 'llm')
    expect(v1).toBeDefined()
    expect(v1!.version).toBe(1)
    expect(v1!.effectiveUntil).toBeNull()

    const v2 = await upsertAICostVersion({ provider: 'deepseek', category: 'llm', inputRate: 30, outputRate: 120 })
    expect(v2.version).toBe(2)

    const active = await getActivePricingVersion('deepseek', 'llm')
    expect(active).toBeDefined()
    expect(active!.version).toBe(2)
    expect(active!.inputRate).toBe(30)
    expect(active!.effectiveUntil).toBeNull()

    const versions = await listAICostVersions('deepseek', 'llm')
    expect(versions).toHaveLength(2)
    expect(versions[0].version).toBe(2)
    expect(versions[1].version).toBe(1)
    expect(versions[1].effectiveUntil).not.toBeNull()
  })

  it('old version is never mutated after a new version is created', async () => {
    const v1 = await getActivePricingVersion('deepseek', 'llm')
    await upsertAICostVersion({ provider: 'deepseek', category: 'llm', inputRate: 99, outputRate: 199 })
    const versions = await listAICostVersions('deepseek', 'llm')
    const old = versions.find((v) => v.version === 1)!
    expect(old.inputRate).toBe(v1!.inputRate)
    expect(old.outputRate).toBe(v1!.outputRate)
  })
})

describe('L. Pricing Pinning + Missing Pricing', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser(PHONE, 100)
  })

  it('usage log pins the active pricing version; later cost change keeps historical cost', async () => {
    const v1 = await getActivePricingVersion('deepseek', 'llm')
    await logAIUsage({
      phone: PHONE,
      providerId: 'deepseek',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'post_generation',
      tokensInput: 3000,
      tokensOutput: 1500,
      estimatedCostCents: 7,
      durationMs: 100,
      success: true,
      pricingVersionId: v1!.id,
    })
    await upsertAICostVersion({ provider: 'deepseek', category: 'llm', inputRate: 999, outputRate: 999 })
    const cost = await billingEngine.getUserCost(PHONE)
    expect(cost.totalCost).toBe(7)
    expect(cost.byProvider['deepseek:deepseek-chat']).toBe(7)
  })

  it('missing pricing is never fabricated as 0 — profitability flags it', async () => {
    await getDb().delete(aiProviderCostVersions).where(eq(aiProviderCostVersions.category, 'llm'))
    const prof = await evaluatePackageProfitability()
    const starter = prof.find((p) => p.packageName === 'Starter')!
    expect(starter.missingPricing).toContain('llm')
    expect(starter.status).toBe('warning')
    const zero = prof.find((p) => p.missingPricing.length > 0 && p.status === 'profitable')
    expect(zero).toBeUndefined()
  })
})

describe('M. Margin Guard (BLOCK / WARNING / PROFITABLE)', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
  })

  it('with seed rates every package is profitable (PROFITABLE)', async () => {
    const r = await checkProposedMargin([])
    expect(r.result).toBe('PROFITABLE')
    expect(r.lossPackages).toHaveLength(0)
  })

  it('a cost increase that sinks a package → BLOCK with lossPackages', async () => {
    const r = await checkProposedMargin([{ provider: 'deepseek', category: 'llm', inputRate: 100000, outputRate: 100000, imageRate: 0, audioRate: 0 }])
    expect(r.result).toBe('BLOCK')
    expect(r.lossPackages.length).toBeGreaterThan(0)
  })

  it('a margin between 0% and 30% → WARNING', async () => {
    await createPackage({
      name: 'Slim',
      slug: 'slim',
      description: 'Cheap package',
      priceCents: 210,
      includedTokens: 100,
      billingPeriod: 'monthly',
      features: { instagram_publishing: true, facebook_publishing: true, voice_transcription: true },
    })
    const r = await checkProposedMargin([])
    expect(r.result).toBe('WARNING')
    const slim = r.packages.find((p) => p.packageName === 'Slim')!
    expect(slim.status).toBe('warning')
  })
})

describe('N. Voice Credit Exactly-Once (charge + refund)', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser(PHONE, 100)
  })

  it('chargeVoiceOnce charges 1 credit; second call is a no-op', async () => {
    const c1 = await tokenEngine.chargeVoiceOnce('audio-media-123', PHONE)
    expect(c1.success).toBe(true)
    expect(c1.newBalance).toBe(99)
    const c2 = await tokenEngine.chargeVoiceOnce('audio-media-123', PHONE)
    expect(c2.alreadyCharged).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(99)
  })

  it('refundVoiceOnce refunds 1 credit; second call is a no-op', async () => {
    await tokenEngine.chargeVoiceOnce('audio-fail-001', PHONE)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(99)
    const r1 = await tokenEngine.refundVoiceOnce('audio-fail-001', PHONE)
    expect(r1.success).toBe(true)
    expect(r1.newBalance).toBe(100)
    const r2 = await tokenEngine.refundVoiceOnce('audio-fail-001', PHONE)
    expect(r2.alreadyRefunded).toBe(true)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)
  })

  it('STT failure → exactly one refund (charge then refund = balance restored)', async () => {
    await tokenEngine.chargeVoiceOnce('audio-stt-001', PHONE)
    await tokenEngine.refundVoiceOnce('audio-stt-001', PHONE)
    const balance = (await getUser(PHONE))!.tokensRemaining
    expect(balance).toBe(100)
    await tokenEngine.refundVoiceOnce('audio-stt-001', PHONE)
    expect((await getUser(PHONE))!.tokensRemaining).toBe(100)
    expect(await countTxnsByOpId('audio-stt-001:refund')).toBe(1)
  })
})

describe('O. Fees + Net Profit in Billing Engine', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
    await registerTestUser(PHONE, 100)
  })

  it('summary includes fees and net profit = revenue - aiCost - fees', async () => {
    const payment = await createPayment({
      phone: PHONE,
      packageId: 'starter',
      tokenCount: 100,
      amountCents: 1500,
      type: 'one_time',
      taxAmount: 15,
      mdrAmount: 30,
    })
    await updatePayment(payment.id, { status: 'completed' })
    await logAIUsage({
      phone: PHONE,
      providerId: 'deepseek',
      category: 'llm',
      model: 'deepseek-chat',
      feature: 'post_generation',
      tokensInput: 100,
      tokensOutput: 50,
      estimatedCostCents: 10,
      durationMs: 50,
      success: true,
    })
    const s = await billingEngine.getSummary()
    expect(s.totalRevenue).toBe(1500)
    expect(s.totalFees).toBe(45)
    expect(s.totalAICost).toBe(10)
    expect(s.netProfit).toBe(1500 - 10 - 45)
    expect(s.monthlyFees).toBe(45)
  })

  it('byProvider reports unpricedRequests', async () => {
    await logAIUsage({
      phone: PHONE,
      providerId: 'groq',
      category: 'stt',
      model: 'whisper-large-v3',
      feature: 'voice_transcription',
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCostCents: 0,
      durationMs: 50,
      success: true,
      unpriced: true,
    })
    const s = await billingEngine.getSummary()
    const row = s.byProvider.find((p) => p.providerId === 'groq')
    expect(row).toBeDefined()
    expect(row!.unpricedRequests).toBe(1)
  })
})

describe('P. Secret Encryption Round-Trip', () => {
  beforeEach(async () => {
    await resetStore()
    await initStore()
  })

  it('createAIProvider stores encrypted key; getAIProvider returns decrypted key', async () => {
    const created = await createAIProvider({
      category: 'llm',
      provider: 'deepseek',
      displayName: 'DeepSeek Test',
      apiKey: 'sk-secret-123',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      config: {},
      isActive: false,
      isDefault: false,
    }, false)
    const fetched = await getAIProvider(created.id)
    expect(fetched).toBeDefined()
    expect(fetched!.apiKey).toBe('sk-secret-123')
  })

  it('masked (••••) apiKey update does NOT overwrite the real secret', async () => {
    const created = await createAIProvider({
      category: 'llm',
      provider: 'deepseek',
      displayName: 'DeepSeek Test',
      apiKey: 'sk-real-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      config: {},
      isActive: false,
      isDefault: false,
    }, false)
    await updateAIProvider(created.id, { apiKey: '••••••••' }, false)
    const fetched = await getAIProvider(created.id)
    expect(fetched!.apiKey).toBe('sk-real-key')
  })
})